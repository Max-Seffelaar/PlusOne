# Capacitor-plan — Fase 17: Native apps (App Store + Play Store)

> Status: **start akkoord (2026-09-17)** — plan opgesteld 2026-07-06, op 2026-09-17 opnieuw getoetst tegen de code (§8) en aangescherpt met vier beslissingen van Max (§2, 9–12). **Herzien 2026-10-11 (§9):** golf 1–5 gebouwd; share sheet (S6) uitgewerkt tot beslissing 16; Tap to Pay van "niet nu" naar golf 6 (beslissing 17) met de geldkant in `payments-plan-claude-code.md`; verouderde regels in §4/§6 bijgewerkt.
> ClickUp-epic: [86exxuvye](https://app.clickup.com/t/86exxuvye) — de fases M1–M4 / N1–N5 / S1–S5 / T1 / L1 hieronder bestaan als losse taken in de lijst.
> Grondslag: spec-beslissing **#37** (native is gepland, geen optie) en **#30** (notificaties = fase 2). Architectuurmodel: **remote-URL Capacitor-wrap** (beslist 2026-06-20) — de native webview laadt de live Vercel-app, server actions blijven werken, geen write-path-rewrite.

**Besluiten Max (2026-07-06):** beide stores in één v1-traject · native push (FCM/APNs) **moet** in v1 zitten · Apple-account/D-U-N-S bestaat nog niet → direct starten (langste doorlooptijd, los van tractie).

**Besluiten Max (2026-09-17):** v1 = volgens plan incl. push (bevestigd) · **iPhone + iPad** in v1 → tablet-layouts worden een harde S5-dependency (T1) · **Android eerst**, iOS zodra het Apple-account er is (S1 gesplitst) · de legal-pagina's (`/privacy`, `/terms`) staan nog niet live → harde S5-dependency (L1).

**Besluiten Max (2026-10-11):** de native app krijgt **betalen aan de deur via Stripe Tap to Pay** (#34 route C) — PlusOne is merchant of record op het eigen Stripe-account (geen Connect), betaalt wekelijks zelf uit; milestone ≥5; fee-model en backend in `payments-plan-claude-code.md`; dit plan bouwt alleen de native laag (golf 6, beslissing 17) · de **share sheet** (S6) komt in de eerste build ná de store-goedkeuring (bevestigt 2026-10-07/10-10), uitgewerkt in beslissing 16.

---

## 1. Waar we staan (readiness-audit 2026-07-06, herzien 2026-09-17)

De codebase is **~85% wrap-klaar; geen blockers** voor het remote-URL-model. Kolom "2026-09-17" = geverifieerd tegen `main` op die datum (zie §8 voor de check per claim).

| Gebied | Status | Toelichting |
|---|---|---|
| Auth | ✅ webview-safe | OTP + magic-link via `/auth/confirm?token_hash=…` en `/auth/callback` (pure HTTP-redirects, geen popups), `@supabase/ssr`-cookies, e-mailtemplates op `{{ .SiteURL }}`. Geen social login → Apple's "Sign in with Apple"-eis (4.8) is niet van toepassing. |
| Deur offline | ✅ warm + koud (Android, na één online bezoek) · iOS: S1b | Warm resume werkt in browser én shell: IndexedDB (TanStack-persister + outbox in `src/features/door/`); sign-out wist IDB én de sessie-cache (`signOutDevice`). **Koude start offline sinds N7** (2026-09-28): de SW registreert ook onder `/app` en seedt `/app` (sessie-bucket) + de geladen chunks; offline stuurt de SW `/` naar `/app/door`, en de Deur-tab mount het laatst gepinde deur-event uit de deur-IDB als de kandidaten-query niet kan laden (nooit over een geladen lijst). Bewezen in `tests/e2e/door-offline-reload.spec.ts` (offline reload + koude start op `/` + drain, DB-state). Android: `server.errorPath` → `native/www/offline.html` herstelt zelf bij reconnect. iOS blijft warm-only tot S1b App-Bound Domains op een device bevestigt. Beslissing 15, `docs/native/door-cold-start-spike.md`. |
| PWA-shell / SW | ✅ | Manifest compleet (maskable icons 192/512). De SW wordt op `/door` én `/app` geregistreerd (`src/components/register-sw.tsx`, N7). In WKWebView draaien service workers alleen met **App-Bound Domains** (`WKAppBoundDomains` in Info.plist) — staat sinds N3 aan; niets *hangt* van de SW af (online werkt alles zonder). |
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
| Share sheet (S6) | ⚠️ web af, native open (2026-10-11) | 5b (PR #443) leverde `/app/share` + de in-memory inbox (`src/features/guests/share-inbox.ts`); de Android-PWA deelt via `share_target`; de native shells pas met S6 (beslissing 16, golf 6, ná de store-goedkeuring). |
| Deurbetalingen / Tap to Pay | 🔶 gepland, golf 6 (2026-10-11) | Alleen `guest_tiers.door_price_cents`/`vat_percent` (display-only) en de inerte `pay`-vlag in `src/features/door/model.ts` bestaan; geen `entry_payments`, geen Connect, geen Terminal. Geldstroom + backend: `payments-plan-claude-code.md`; native laag: beslissing 17. |

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
15. **Deur cold-start-offline: remote-URL blijft, SW op Android, App-Bound Domains op iOS, geen lokale deur-bundel (N4, 2026-09-25, `docs/native/door-cold-start-spike.md`).** De shell start koud altijd op de origin → `/app`, dus de Deur-tab is het offline-oppervlak, niet `/door/<id>`. Die tab boot vandaag nergens koud-offline: de SW registreert alleen op `/door`, en `MobileDoorBranch` mount `DoorProvider` pas na een netwerk-read van de kandidaten. Fix = web-side (N7): SW ook onder `/app` registreren + het laatst gepinde deur-event in de deur-IDB onthouden, zodat de tab offline uit zijn eigen caches mount. Android WebView ondersteunt de SW; Capacitor 8 injecteert de bridge via `addDocumentStartJavaScript` per origin, dus een door de SW geserveerde pagina houdt de bridge (device-check in het spike-script). iOS krijgt de SW alleen met App-Bound Domains; die staan sinds N3 (#340) al aan (`WKAppBoundDomains = [app.plus-one.io]` + `ios.limitsNavigationsToAppBoundDomains: true`, ook als beveiligingsgrens tegen de prefix-match van `server.url`). Dat beperkt uitsluitend top-level-navigatie (Supabase fetch/WebSocket en `@capacitor/browser` blijven werken). S1b verifieert bridge + SW op een echte iPhone én iPad vóór submissie; faalt de bridge, dan eerst een diagnostische TestFlight-build zonder de keys, en `localhost` gaat alleen in de lijst als die device-test dat aantoont. Lokaal bundelen kost een tweede build, een token-handoff tussen origins (security-surface), een tweede kopie gasten-PII en deur-updates via store-review: 4–6 sessies, afgewezen voor v1; alleen heroverwegen bij ≥25 venues als device-tests aantonen dat remote-URL niet betrouwbaar te krijgen is. *Alt: nu bundelen = het "een deploy ís de update"-voordeel weg voor precies het scherm dat het vaakst verandert.*
16. **Share sheet (S6) pas ná de store-goedkeuring, consume-once, PII nooit onbeschermd op schijf (2026-10-11; bevestigt Max 2026-10-07/10-10).** De web-kant is af (5b, PR #443: `src/features/guests/share-inbox.ts` met `putSharedText`/`peekSharedText`, scherm `/app/share`, SW-hop naar `#text=`). De native kant: (a) één plugin `PlusOneShareInbox` met `consume()`, aangeroepen **bij mount én** bij `appStateChange`/`onNewIntent` — `appStateChange` vuurt niet bij een koude start, en `MainActivity` is `singleTask`, dus een share terwijl de app draait komt via `onNewIntent`; de plugin leest het intent-extra of het App-Group-bestand **één keer en wist het**, anders herhaalt een reload de share (de sticky-launch-URL-les uit `src/components/native-app-links.tsx`); (b) de web-listener mount in de root layout naast `NativeAppLinks` en navigeert met de Next-router naar `/app/share` — module-geheugen overleeft geen volledige navigatie, dus nooit `location.assign`; een share zonder sessie gaat verloren, de lege share-box zegt dat al; (c) iOS: de extensie schrijft naar een **bestand** in de App Group-container met backup-exclusie en `NSFileProtectionComplete`, geen `UserDefaults` (die gaan mee in de iCloud-backup), TTL 10 minuten, verwijderd bij consume — de CLAUDE.md-regel "device storage is session-scoped unless PII-free"; (d) alleen tekst (`NSExtensionActivationSupportsText`), geen bestanden: Excel en Sheets delen bestanden, kopiëren → plakken blijft daarvoor de weg (5b-test Max 2026-10-10); (e) Codemagic: `ios_signing.bundle_identifier` ook `app.plusone.guestlist.share`, App Group-capability op beide App IDs (Max), IPA-check op de ingebedde `.appex`, en `tests/unit/codemagic-ios-release.test.ts` (telt precies twee `TARGETED_DEVICE_FAMILY`-regels) + `tests/unit/app-links.test.ts` (telt VIEW-intent-filters) worden in dezelfde PR bijgewerkt, nooit verzwakt. *Alt: vóór de goedkeuring meebouwen = extra review-oppervlak op een eerste submissie.*
17. **Tap to Pay (#34 route C) is gepland als golf 6; geld, fee-model en backend staan in `payments-plan-claude-code.md` (2026-10-11, Max).** Dit plan dekt alleen de native laag: (a) plugin `@capacitor-community/stripe-terminal` (Tap to Pay-discovery met `locationId`; Android `minSdkVersion` 24 → 26; `MODIFY_AUDIO_SETTINGS`; alleen de permissies die Tap to Pay nodig heeft, niet de Bluetooth-set voor fysieke readers); de web-kant detecteert een oude shell zonder plugin zoals bij `PlusOnePushConfig`; (b) Apple: entitlement `com.apple.developer.proximity-reader.payment.acceptance` — development aanvragen door de Account Holder (Max, weken doorlooptijd, start nu), distribution na de interne test; de verplichte "How to Tap"-overlay (`ProximityReaderDiscovery`, iOS 18, fallback-UI eronder); HIG-review; **iPhone-only** (iPhone XS+, iOS n-1) — de iPad-deur (T1) neemt nooit Tap to Pay, daar blijft QR/iDEAL (route A); (c) Android 13+, GMS, bootloader locked, security-patch ≤ 12 maanden, **Developer options uit** → Max' debug-toestel kan het niet testen, device-test op een release-build via Play internal; Android-tablets (o.a. Galaxy Tab Active5) kunnen wél; (d) **betalen is online-only** (Stripe: offline mode niet compatibel met Tap to Pay) — de check-in blijft outbox (#25), de betaling niet; (e) store: Apple 3.1.3(e) — entree is een fysieke dienst, dus géén IAP en toegestaan in de shell; de store-tax-regel in CLAUDE.md geldt alleen voor SaaS-billing; de `PURCHASE_COPY`-guards (`native-store-tax.test.tsx`, `billing.native.test.tsx`, `tests/e2e/native-shell-guard.spec.ts`) blijven tot billing/onboarding beperkt en de deur krijgt een eigen guard; Play "Financial features" en Apple App Privacy opnieuw beantwoorden; (f) Codemagic: entitlement in `App.entitlements`, profiel opnieuw, IPA-check uitbreiden. *Alt: route B (Stripe smart reader, server-driven) = geen Apple-traject, wel €199–289 hardware per deur; blijft een optie voor venues met veel deurverkoop.*

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
| M1 | NOW | **D-U-N-S** aanvragen (gratis, 1–2 wk; entiteit: **The Operators (eenmanszaak), KvK 99992841; statutair/KvK-adres Goirkestraat 74-15, 5046 GM Tilburg; kantoor Chasséstraat 3-1, Amsterdam** (besluit Max 2026-09-25) — D-U-N-S, Apple-org, Play-org en de juridische teksten op die naam) → **Apple Developer org-account** (€99/jr; org-verificatie 1–2 wk extra, incl. telefonische check). Langste doorlooptijd van het hele traject. |
| M2 | NOW | **Google Play Console org-account** ($25 eenmalig; een org-account vermijdt de regel voor nieuwe personal accounts — **20 testers, 14 dagen** closed test vóór productie; Play vraagt ook D-U-N-S). |
| M3 | NOW | **Firebase-project** aanmaken (gratis — deblokkeert de echte send-test van N2); **APNs-key** uploaden zodra het Apple-account er is. |
| M5 | ✅ 2026-09-25 | **`app.plus-one.io` live zetten** (vastgesteld 2026-09-25 bij Max' eerste Android-debugbuild: leeg scherm, want het Vercel-project `plus-one` heeft alleen `plus-one-phi.vercel.app`). Domein koppelen in Vercel, `NEXT_PUBLIC_APP_URL=https://app.plus-one.io` (Production) + redeploy, Supabase Auth Site URL + Redirect URL `https://app.plus-one.io/**`, links op `www.plus-one.io` naar de app bijwerken. Harde voorwaarde vóór de eerste S1a-rollout en vóór S1b: `server.url` en `WKAppBoundDomains` wijzen alleen naar dit domein. Tot dan: Android-debug via `CAP_SERVER_URL=https://plus-one-phi.vercel.app` (`android/README.md`); iOS kan niet zonder. |
| M4 | SHIP | Store-listing NL, screenshots (**iPhone 6,7" + iPad 13"** — beslissing 10), privacy nutrition labels + Play data-safety (spiegelen `/privacy` uit L1), export compliance (HTTPS-only → exempt), Codemagic-account + App Store Connect API-key. |

### Dev-track

| # | Fase | Tag | Effort | Deps | Deliverable |
|---|------|-----|--------|------|-------------|
| N1 | Webview-prep fixes | NOW | 1 | — | `copyText()`-kit-helper (6 call sites), `openExternal()`-kit-helper (`@capacitor/browser` op native; `onboarding.tsx`), `viewport-fit=cover` in de `viewport`-export van `src/app/layout.tsx`, CSP-wrap-notes in `next.config.js`, CLAUDE.md-checklist-regel "geen `target=_blank`", sanity-pass op de checklist over de bestaande schermen. |
| N2 | Push-backend | NOW | 2 | M3 (alleen voor echte send) | Migraties `push_tokens` + `notification_outbox` (mét grant matrix, §3), AFTER-triggers op `quota_requests`/`guest_requests`, pg_net-wiring, revocatie-RPC-uitbreiding, `supabase/functions/push-dispatch` (FCM v1 + token-pruning), pg_cron-retry, pgTAP, types regenereren. Pipeline **live-maar-slapend**, testbaar tegen gemockte FCM. High-risk surface → fresh-session `/code-review` + `/security-review`. |
| N3 | Capacitor-scaffold + Android | NOW | 1–2 | N1 | `capacitor.config.ts` met `server.url` = prod, `android/`+`ios/` gecommit (iOS: `TARGETED_DEVICE_FAMILY` 1,2 — iPad erin, beslissing 10), `@capacitor/app` backButton → `router.back()` met exit op `/app`-root, statusbar/splash-basis, safe-area-check, `WKAppBoundDomains`-keuze vastleggen, CSP-fix alleen als de Android-bridge geblokt wordt (hash/nonce, nooit `unsafe-inline`). **Android-debugbuild op Max' Windows-machine valideert het hele model** (auth, server actions, deur-offline, externe links, back-button). |
| N4 | Deur cold-start-spike | NOW | 1 | N3 | Schriftelijke go/no-go: is remote-URL cold-start-offline acceptabel voor de deur, of bundelen we alleen de (al client-side) deur-route lokaal? Neem de App-Bound-Domains-optie (SW-shell-cache in WKWebView) mee als derde variant. Geen productiecode. **Besluit 2026-09-25 → beslissing 15:** Android remote-URL + SW (go), iOS App-Bound Domains (al aan sinds N3; device-verificatie in S1b), lokaal bundelen no-go; web-side follow-up N7 nodig voor élke variant. |
| N7 | Deur koud-offline in de shell | NOW | 1 | N4, N6 | ✅ **Gebouwd 2026-09-28** (branch `claude/n7-door-cold-offline`, akkoord Max 2026-09-28). SW ook onder `/app` (`src/components/register-sw.tsx`): `/app` naar de sessie-bucket (`seed-session`), geladen `/_next/static/`-chunks naar de shell (`seed-assets`, anoniem), shell-cap 60 → 200; offline `/` → `/app/door` alleen als de sessie-bucket een `/app` heeft. Laatst gepinde deur-event (`{venueId, eventId, name}`) in de deur-IDB (`src/features/door/offline/last-door.ts`, gewist door `idbClearAll`); `MobileDoorBranch` mount het alleen als de kandidaten-lijst niet kan laden (paused/error/`navigator.onLine === false`), nooit over een geladen lijst. Bugfix onderweg: een offline mislukte snapshot-refetch (status `error`, data behouden) viel uit de volgende IDB-write → tweede offline reload = lege deur. Android `server.errorPath` → `native/www/offline.html` (+ `ACCESS_NETWORK_STATE`). Rest: ronde B van het spike-script op Max' Android-build. |
| N5 | Push-client + native adapter | NOW | 1 | N2+N3 | `CapacitorPushProvider`, runtime-selectie, permission-UX, register/unregister-lifecycle, tap-navigatie. Werkende push op Android; iOS volgt in S1b. Pushtekst toont nooit de eventnaam (D12, Legal v0.3): generieke tekst, details pas na tap. |
| T1 | Tablet-layouts 641–1023px | SHIP | 2–3 | — | Beslissing 10. Elk `po`-scherm bruikbaar op iPad portrait + landscape; `ResponsiveShell`-breakpoint-beslissing vastleggen; Deur-tab op tablet eerst. Levert de iPad-screenshots voor M4. → [z8uq9m0fzj](https://app.clickup.com/t/z8uq9m0fzj) |
| L1 | Legal-pagina's live | SHIP | 1 | — | `plus-one.io/legal` (tabs `#terms`, `#privacy`, `#subprocessors`, `#dpa`, `#guest-terms`) in de Plus-One.io-repo, content uit `docs/legal/` (v0.2-herziening: ClickUp z8uq9m0w3t + z8uq9m0w3u), live pas na Max' juridische check; app-kant: link naar de gastvoorwaarden op `/e/[slug]` + `TERMS_VERSION` ophogen (na N1). → [86ey1vbrj](https://app.clickup.com/t/86ey1vbrj) (bestaand, prod-ready-programma). |
| S1a | Android-build + cloud-CI | SHIP | 1 + Max | M2, N3 | `codemagic.yaml` Android-workflow, upload-key beheer, **Play internal track → closed test**; buildnummer = CI-runnummer. Push (N5) end-to-end op een echte Android. Kan zonder Apple-account. |
| S1b | iOS-build | SHIP | ½ + Max | M1, M3, N3, S1a | iOS-workflow in dezelfde `codemagic.yaml`, managed signing, **TestFlight**; APNs-via-FCM geverifieerd op een echte iPhone én iPad. → [z8uq9m0gvn](https://app.clickup.com/t/z8uq9m0gvn) **Gebouwd 2026-10-01:** workflow `ios-release` (main-only, prod-config-guard, ASC-integratie-signing, upload → TestFlight internal, nooit App Store-submissie), native APNs-via-FCM (Firebase Messaging via SPM, iOS `PlusOnePushConfig`), runbook `docs/native/ios-release.md`. **Wacht op Max:** runbook stap 1–8 (App ID-capabilities, ASC-record, API-key, Codemagic-cert/profiel, `GoogleService-Info.plist`, APNs-key) + device-test. **Gedaan 2026-10-05 (#374):** web-side iOS-push via FCM (`capacitor-provider.ts`, `tokenTransport: 'fcm'`), consent-first auto-init uit op beide platformen. |
| S2 | Icons/splash/store-wiring | SHIP | 1 | N3 | `@capacitor/assets` vanuit het bestaande maskable 512-icoon, store-metadata in repo, screenshots (Max, na T1). |
| S3 | Review-login + demo-venue | SHIP | 1 | vóór S5 | Env-gated `review-login`-route + demo-tenant-seedscript, geaudit, security-checklist toegepast. High-risk surface → fresh-session `/security-review`. |
| N6 | Deurvariant op touch óf <1024px | NOW | ½–1 | N3, T1 | Beslissing 14: de Deur-tab kiest de outbox-deur bij `pointer: coarse` of <1024px, de cockpit alleen bij fijne pointer ≥1024px; `door-branch.tsx`/`DoorRoute.tsx`/`app.tsx`, geen hydration-flip die `DoorProvider` remount, `door-render-isolation` blijft groen. ClickUp-taak: [z8uq9m0y1x](https://app.clickup.com/t/z8uq9m0y1x) |
| S4 | Universal links / app links | SHIP | 1 | M1, N3 | AASA + `assetlinks.json` route handlers op het domein, **alleen `/auth/*`** (beslissing 11), `appUrlOpen`-listener → in-app-nav. **Gebouwd 2026-09-28 (`docs/native/app-links.md`).** Live na merge + deploy: AASA (Team ID `52ZZ6F5V5Y`, exact `/auth/confirm` + `/auth/callback`, `/e/*` expliciet uitgesloten), middleware-matcher laat `/.well-known/` door, `appUrlOpen`/launch-URL-listener. **Wacht op Max:** (a) `ANDROID_APP_LINK_SHA256` in Vercel Production zodra Play App Signing de fingerprints heeft (S1a stap 7/10) — tot dan 404't `assetlinks.json` bewust; (b) iOS: **Associated Domains**-capability aanvinken op het App ID `app.plusone.guestlist` vóór de eerste S1b-signing — het entitlement (`applinks:app.plus-one.io`) staat al in `ios/App/App/App.entitlements`; (c) device-verificatie van beide op S1a/S1b-builds. |
| S5 | Submissie + 4.2-verdediging | SHIP | 1 + Max | alles, incl. T1 + L1 | Review-notes (push + offline deur + demo-creds + account-deletion-toelichting), Play data-safety-form, staged rollout, review-responses (reken op iteraties). Android-submissie kan vóór iOS (beslissing 9). **Stand 2026-10-06:** Android-pack gebouwd (#363: data-safety, review-notes, rollout, console-checklist; #367: "App review sign-in"-link op `/login`; store-tax-guards 2026-10-06); beide submissies wachten op de eerste Codemagic-builds. |
| S6 | Share-sheet: iOS Share Extension + Android ACTION_SEND | SHIP | 1 + Max | S5 (eerste store-goedkeuring op beide stores, Max 2026-10-07/10-10); 5b ✅ (PR #443) | Beslissing 16. Eén plugin `PlusOneShareInbox` met `consume()` voor beide platformen, aangeroepen bij mount én bij `appStateChange`/`onNewIntent`, consume-once. **Android:** `intent-filter` ACTION_SEND `text/plain` op MainActivity; `onNewIntent` (singleTask); het extra wordt na één lezing gewist. **iOS:** Share Extension-target in `ios/App` (bundle-id `app.plusone.guestlist.share`), `NSExtensionActivationSupportsText`, App Group `group.app.plusone.guestlist` op app én extensie; de extensie schrijft `{text, receivedAt}` naar een bestand in de App Group-container (backup-exclusie, `NSFileProtectionComplete`, TTL 10 min) en toont "Added to PlusOne — open the app to import" (geen openURL-truc vanuit de extensie: niet ondersteund, review-risico). **Web-kant:** listener in de root layout naast `NativeAppLinks`; `putSharedText()` uit `src/features/guests/share-inbox.ts` + Next-router-navigatie naar `/app/share`, nooit tekst in de URL, nooit `location.assign`. **Codemagic/guards:** beslissing 16 (e). **Max:** App Group-capability op beide App IDs, provisioning profile voor de extensie. Een nieuw native target gaat opnieuw langs review. |
| P3a | Tap to Pay-plugin (native + web-seam) | ≥5 | 2 | P1 van `payments-plan-claude-code.md` gemerged; Apple development-entitlement binnen (P0); S1b-device-test | Beslissing 17 (a)–(d). `@capacitor-community/stripe-terminal` in beide shells, connection-token-route (onze Stripe-key, altijd met `location`), Terminal Location per company-locatie, card-present PaymentIntent server-side op ons eigen account (geen Connect), oude-shell-detectie, Android `minSdk` 26, How-to-Tap-overlay, device-test op een Android release-build + iPhone (TestFlight). High-risk (Stripe-secret-route, geld) → reviewer-sessie. |
| P3b | Tap to Pay store-kant | SHIP | ½ + Max | P3a | Beslissing 17 (e)–(f). Distribution-entitlement (Max), `App.entitlements` + Codemagic-profiel + IPA-check, store-declaraties en review-notes opnieuw (Play "Financial features", Apple App Privacy, 3.1.3(e)-toelichting, Tap to Pay als 4.2-meerwaarde), carve-out op de store-tax-guards + eigen deur-guard. |

**Totaal ≈ 14–16 sessies** (was 10–12; +T1, +L1, N1 iets zwaarder) **+ golf 6 ≈ 3½ sessies** (S6 1, P3a 2, P3b ½; de betaal-backend P1/P2/P4 telt in `payments-plan-claude-code.md`). Kritieke pad naar de App Store: M1 → S1b → S5-iOS; naar Play: N1 → N3 → N5 → S1a → S5-Android, zonder Apple-wachttijd. Golf 6 hangt aan de eerste store-goedkeuring (S6) en aan het Apple Tap to Pay-entitlement (P3a).

### Parallel-golven (2026-09-17; golf 6 toegevoegd 2026-10-11)

| Golf | Parallel | Wacht op |
|---|---|---|
| 1 | N1, N2, S3, T1, L1 | niets (N2 en S3 niet tegelijk tegen de lokale stack resetten — één DB-eigenaar) |
| 2 | N3 | N1 gemerged; Max: Android-debugbuild |
| 3 | N4, N5, N6, S2, S4, S1a (+ N7 na akkoord) | N3 gemerged (S1a ook M2 + M5; N6 ook T1; N7 na N4 + N6) |
| 4 | S5-Android | alles behalve S1b |
| 5 | S1b → S5-iOS | M1 + M3 |
| 6 | S6 → P3a → P3b (sequentieel: alle drie raken `ios/App`, `codemagic.yaml` en de iOS-guard-tests) | S6: eerste store-goedkeuring op beide stores; P3a: betaalplan P1 gemerged + Apple development-entitlement; P3b: P3a + distribution-entitlement |

N1, N3 en N5 raken alle drie `app.tsx`/root layout → bewust sequentieel. Max is de bottleneck tussen golven (test-handoff + merge per PR): twee à drie parallelle sessies per golf is realistisch.

## 5. Wat we bewust NIET nu doen

Web-push-adapter · scheduled/reminder-pushes · notification-preferences-matrix (één toggle volstaat) · Stripe smart readers (#34 route B; Tap to Pay zelf is sinds 2026-10-11 golf 6, beslissing 17) · ops-module-push (#35) · de volledige app lokaal bundelen · billing/IAP/checkout in de app (CLAUDE.md-regel, Apple IAP) · een store-staging-omgeving · widgets/live activities · per-device push-analytics · `@sentry/capacitor` (native-shell-crashes) · in-app account-deletion-flow (invite-only, zie §1) · een minimum-versie/kill-switch voor de shell (remote-URL: een deploy ís de update).

## 6. Release-checklist (draft — afvinken in S5)

- [ ] Apple + Play **org**-accounts actief
  - [ ] Android: Play-**org**-account (M2) volgens `docs/native/android-release.md` §9 — niet uit de repo te bewijzen, Max vinkt af.
- [ ] `app.plus-one.io` live op het Vercel-project `plus-one`, `NEXT_PUBLIC_APP_URL` + Supabase Site/Redirect URLs erop (M5)
  - [ ] Android: harde precondition vóór elke rollout (`android-release.md` bovenaan) — live-check door Max, niet uit de repo te bewijzen.
- [ ] Firebase-project + APNs-key geüpload
  - [x] Android: Firebase-project bestaat, `android/app/google-services.json` staat in de repo (N5). APNs-helft volgt in S1b. Let op: `codemagic.yaml` heeft nog `REQUIRE_GOOGLE_SERVICES: "false"` — zie PR 86ey6bfyj (buiten scope gemeld).
- [ ] Push end-to-end geverifieerd op TestFlight + Play internal (alle drie use-cases)
  - [ ] Android: push werkt end-to-end op Max' toestel (2026-09-30, orchestrator) — device-test, dus Max vinkt af; TestFlight-helft in S1b.
- [ ] Remote logout killt push-tokens (handmatige test)
  - [ ] Android: DB-kant gedekt door pgTAP `push_tokens.test.sql` (token hangt aan de sessie); de handmatige toesteltest staat nog open.
- [ ] Android-backbutton: retraces de nav-stack, exit alleen op stack-root
  - [ ] Android: gebouwd + unit-getest (`src/components/po/native-back-button.test.tsx`); toesteltest door Max staat nog open.
- [ ] Safe-area correct op notch-device (statusbar + home-indicator)
- [ ] Externe links (voorwaarden/privacy) openen in de systeembrowser, niet in de webview
  - [ ] Android: `openExternal()` via `@capacitor/browser`, getest in `kit.webview.test.tsx` + `ConsentScreen.test.tsx`; toesteltest open.
- [ ] iPad portrait + landscape: elk scherm bruikbaar (T1); iPad-screenshots in de listing
- [ ] Deur-cold-start-besluit (N4 → beslissing 15) geïmplementeerd: N7 gemerged, spike-script ronde B 13/13 op Android, bridge + SW op iPhone/iPad (S1b)
- [ ] `REVIEW_LOGIN_CODE` gezet + demo-venue geseed; creds in de review-notes
  - [x] Android: opgelost 2026-10-06 (#367) — "App review sign-in"-link op `/login` zolang het review-venster open staat; review-notes-tekst in `docs/store/play-review-notes.md` §1. (Was: ⛔ geen weg naar `/auth/review-login` vanuit de shell.)
- [ ] `/privacy` + `/terms` live (L1); privacy nutrition labels + Play data-safety ↔ die pagina's consistent
  - [x] L1: Version 1.0 live op `www.plus-one.io/legal` sinds 2026-10-06 (Legal v0.3 D). De zeven ⛔ L1-markeringen in `docs/store/play-console-checklist.md` zijn daarmee verouderd (opruimen bij de eerstvolgende store-docs-PR).
  - [ ] Android: Play data-safety herschreven als console-flow in `docs/store/play-store-listing.md`, getoetst tegen policy v0.2 (afwijkingen in de PR van 86ey6bfyj); de consistentiecheck tegen Version 1.0 staat nog open.
- [ ] Account-deletion-toelichting (invite-only, support-adres) in de review-notes
  - [ ] Android: tekst staat in `docs/store/play-review-notes.md` §1 + aanbeveling in `play-store-listing.md`; wacht op Max (mailbox, delete-account-URL, evt. in-app-pad = eigen taak).
- [ ] Export compliance beantwoord (HTTPS-only → exempt)
  - [x] Android: n.v.t. — Play Console stelt deze vraag niet (alleen Apple); vastgelegd in `docs/store/play-store-listing.md`.
- [ ] Geen billing-UI bereikbaar in de app (`isNativeShell()`-seam gecontroleerd op elke purchase-affordance)
  - [x] Android: seam + guards sinds 2026-10-06 (`native-store-tax.test.tsx`, `billing.native.test.tsx`, `tests/e2e/native-shell-guard.spec.ts`) dekken billing, onboarding, de More-rij en de soft-block-banner.
  - [ ] De deur krijgt met golf 6 wél een betaalknop (toegestaan, beslissing 17 (e)); die carve-out en een eigen deur-guard horen bij P3b, de walk-through in de native app blijft daarna nodig.
- [ ] NL-listings compleet (beschrijving, screenshots, keywords)
  - [ ] Android: NL/EN-teksten compleet in `docs/store/play-store-listing.md`; screenshots (telefoon + 7"/10" tablet) nog niet gemaakt.
- [ ] Versioning vast: buildnummer = CI-runnummer
  - [x] Android: versionCode = max(Play internal + 1, `BUILD_NUMBER`), afgedwongen door `tests/unit/codemagic-android-release.test.ts` (bewust niet puur het CI-runnummer, zie `android-release.md`).
- [ ] Offline-banner-gedrag bij mid-session-netwerkverlies gecheckt in de webview
  - [ ] Android: `ACCESS_NETWORK_STATE` staat in het manifest (N7); de check zelf is een toesteltest.
- [ ] CLAUDE.md + spec #37 bijgewerkt; ClickUp-taken dicht

## 7. Kritieke bestanden

- `src/features/notifications/provider.ts` — de seam waar alle push-werk aan hangt
- `src/features/auth/session-actions.ts` — revocatie-RPC's uitbreiden voor token-invalidatie
- `src/components/po/app.tsx` — backButton-wiring-target (G1: `useRouter()`/`router.back()`; `history-nav.ts` bestaat niet meer, verwijderd toen elk scherm een echte URL kreeg)
- `src/components/po/kit.tsx` — nieuwe helpers `copyText()` + `openExternal()` (N1)
- `src/lib/platform.ts` — `isNativeShell()`, de runtime-seam voor billing-hide, externe links en push-adapterselectie
- `src/lib/legal.ts` — `TERMS_URL`/`PRIVACY_URL` (L1)
- `src/app/layout.tsx` — `viewport`-export (`viewport-fit=cover`, N1)
- `src/components/register-sw.tsx` — SW-registratie voor `/door` én `/app` + de seed-berichten (N7)
- `next.config.js` — CSP/headers bij wrap + AASA/assetlinks-serving
- `src/app/auth/dev-login/route.ts` — template voor de prod review-login-route
- `supabase/templates/` — e-mail-deep-links (`{{ .SiteURL }}`)
- `public/manifest.json` + `public/service-worker.js` — bestaande PWA-shell (blijft; webview registreert de SW gewoon niet als hij niet kan)
- `src/features/guests/share-inbox.ts` — de in-memory share-inbox die de S6-plugin vult (`putSharedText`)
- `src/components/native-app-links.tsx` — het listener- en de-dup-patroon dat de S6-listener volgt
- `src/features/door/model.ts` — de `pay`-vlag die met het betaalplan live gaat
- `payments-plan-claude-code.md` — geldstroom, fee-model en backend voor Tap to Pay (golf 6 bouwt alleen de native laag)

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

## 9. Review 2026-10-11 — plan opnieuw getoetst (share sheet + Tap to Pay)

Aanleiding: Max wil de native app bouwen mét betalen aan de deur (Stripe Tap to Pay) en de OS-share-sheet (op iOS alleen native). Vraag: dekt het plan dat? Antwoord: **golf 1–5 zijn gebouwd en kloppen; S6 was één regel met vijf gaten; Tap to Pay stond in §5 "niet nu" en de geldkant bestond nergens.** Verwerkt:

| Claim / regel | Bevinding 2026-10-11 | Verwerkt in |
|---|---|---|
| S1b "Open: web-side iOS-push-schakelaar" | Verouderd: gebouwd 2026-10-05 (#374, `tokenTransport: 'fcm'`). | §4 S1b |
| §6 "⛔ native app kan niet bij `/auth/review-login`" | Verouderd: #367 zette de "App review sign-in"-link op `/login`. | §6 |
| §6/L1 "legal-pagina's nog niet live" | Verouderd: Version 1.0 live op `www.plus-one.io/legal` sinds 2026-10-06; `docs/store/play-console-checklist.md` draagt nog zeven ⛔ L1-markeringen. | §6 |
| §6 "geen test die elke billing-affordance dekt" | Deels verouderd: de store-tax-guards (2026-10-06) dekken billing, onboarding, More-rij en banner; de deur niet (komt met golf 6). | §6, beslissing 17 (e) |
| S6: pad `src/features/native/share-inbox.ts` | Fout: de inbox is `src/features/guests/share-inbox.ts` (`putSharedText`); 5b is gemerged (PR #443). | §4 S6 |
| S6: "bij `appStateChange` consume()" | Onvolledig: koude start en `onNewIntent` (singleTask) ontbraken; zonder consume-once herhaalt een reload de share. | Beslissing 16 (a) |
| S6: App-Group-`UserDefaults` | Risico: iCloud-backup van PII; bestand met backup-exclusie + TTL. | Beslissing 16 (c) |
| S6: "meenemen in de eerstvolgende store-build nadat 5b live is" | Conflict met Max 2026-10-07/10-10 ("eerste build ná de store-goedkeuring"); het latere besluit wint. | §4 S6, golf 6 |
| S6: Codemagic + guards | Nieuw: een tweede target raakt `ios_signing`, `codemagic-ios-release.test.ts` en `app-links.test.ts`. | Beslissing 16 (e) |
| §5 "Tap to Pay niet nu" | Herzien: Max 2026-10-11 → golf 6 (milestone ≥5); geldstroom (merchant of record op het eigen Stripe-account, geen Connect, wekelijkse uitbetaling), fee-model en backend in `payments-plan-claude-code.md`. | Beslissing 17, §5 |
| Tap to Pay-feiten (Stripe/Apple-docs 2026-10-11) | NL beschikbaar op iPhone én Android (GA); iPhone-only; Android 13+ met Developer options uit; offline niet compatibel; Apple-entitlement development → distribution; How-to-Tap-overlay verplicht; Stripe rekent + €0,10 per Tap to Pay-autorisatie. | Beslissing 17, betaalplan §2 |
| Store-tax-regel vs. deurbetalingen | Carve-out nodig: Apple 3.1.3(e) maakt entree een fysieke dienst; de CLAUDE.md-regel en de `PURCHASE_COPY`-guards gelden alleen voor SaaS-billing. | Beslissing 17 (e), CLAUDE.md |
| ClickUp | Geen taak voor S6, P3a, P3b; de Fase 14-taken (`86exxuuu7`, `86exyp8rc`) staan op ≥25; de epic-beschrijving noemt M3 niet als gedaan. | Aangemaakt 2026-10-11: S6 `z8uq9m4a7d` (to do), P3a `z8uq9m4a7e`, P3b `z8uq9m4a7g` (≥5); Fase 14 P0 `z8uq9m4a7h`, P1 `z8uq9m4a7j`, P2 `z8uq9m4a7m`, P4 `z8uq9m4a7n`, P5 `z8uq9m4a7p`, P6 `z8uq9m4a7q` (≥5), P7 `z8uq9m4a7r` (≥25), met de afhankelijkheden S6 → P3a → P3b en P0 → P1 → P2/P4. De hertag van de oude Fase 14-taken en de epic-beschrijving (M3) blijven bij Max. |

Niet opnieuw getoetst: Codemagic-prijzen, de Apple-doorlooptijd van het Tap to Pay-entitlement (Stripe: "weken"), `@capacitor-community/stripe-terminal` 8.x tegen Capacitor 8.5 (bij P3a vaststellen; de Capgo-fork is het alternatief).
