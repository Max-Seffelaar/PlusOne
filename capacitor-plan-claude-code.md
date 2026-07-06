# Capacitor-plan — Fase 17: Native apps (App Store + Play Store)

> Status: **plan, klaar voor uitvoering zodra er tractie is** (opgesteld 2026-07-06, sessie met Max).
> ClickUp-epic: [86exxuvye](https://app.clickup.com/t/86exxuvye) — de fases M1–M4 / N1–N5 / S1–S5 hieronder bestaan als losse taken in de lijst.
> Grondslag: spec-beslissing **#37** (native is gepland, geen optie) en **#30** (notificaties = fase 2). Architectuurmodel: **remote-URL Capacitor-wrap** (beslist 2026-06-20) — de native webview laadt de live Vercel-app, server actions blijven werken, geen write-path-rewrite.

**Besluiten Max (2026-07-06):** beide stores tegelijk in één v1-traject · native push (FCM/APNs) **moet** in v1 zitten · Apple-account/D-U-N-S bestaat nog niet → direct starten (langste doorlooptijd, los van tractie).

---

## 1. Waar we staan (readiness-audit 2026-07-06)

De codebase is **~85% wrap-klaar; geen blockers** voor het remote-URL-model:

| Gebied | Status | Toelichting |
|---|---|---|
| Auth | ✅ webview-safe | OTP + magic-link via `/auth/confirm?token_hash=…` (pure HTTP-redirects, geen popups), `@supabase/ssr`-cookies, e-mailtemplates op `{{ .SiteURL }}` |
| Deur offline | ✅ | IndexedDB (TanStack-persister + outbox in `src/features/door/`), nergens SW-afhankelijk; sign-out wist IDB |
| PWA-shell | ✅ | Manifest compleet (maskable icons 192/512), handgeschreven app-shell-SW, prod-only registratie |
| Backbutton | ⚠️ voorbereid | `src/components/po/history-nav.ts` is expliciet ontworpen voor een `@capacitor/app` `backButton`-listener → `goBack()`; nog niet bedraad (N3) |
| Safe-area | ⚠️ bijna | `env(safe-area-inset-bottom)` zit al in de shells; `viewport-fit=cover` ontbreekt in de root layout (N1) |
| Notifications | ⚠️ alleen seam | `src/features/notifications/provider.ts` = `NoopNotificationProvider`; geen tokens-tabel, geen dispatch, geen adapter (N2+N5) |
| Kleine gaten | ⚠️ | clipboard-fallback in `events.tsx`; CSP-check bij wrap (N1/N3) |
| Store-risico's | 🔶 | Apple **Guideline 4.2** (webview-wrapper-afwijzing) → verdediging = push + offline deur; review-**demo-login** nodig (app is invite-only; dev-login is hard non-prod-gated) → S3 |

## 2. Kernbeslissingen

Eén keuze per punt; alternatief in één regel.

1. **Push-transport: FCM HTTP v1 only.** FCM levert aan Android én iOS (APNs onder water) — één API, één credential (Firebase service-account-JSON in Edge Function-secrets). *Alt: directe APNs = tweede credential + codepad zonder winst op deze schaal.*
2. **Géén web-push-adapter in v1.** `'web-push'` blijft in het transport-enum en de provider-seam; alleen de Capacitor-adapter wordt gebouwd. *Alt: web-push voor de browser-PWA nu = twee transports pre-tractie; iOS web-push vereist bovendien een home-screen-install die niemand doet.*
3. **Dispatch: DB AFTER-triggers → `notification_outbox` → pg_net → `push-dispatch` Edge Function.** Triggers missen geen codepad (guest requests komen via de publieke landing-route én po-schermen binnen); de outbox geeft observability + pg_cron-retry; FCM-secrets blijven uit Vercel. *Alt: Edge Function vanuit server actions aanroepen = mist insert-paden en verplaatst FCM-creds naar Vercel.*
4. **Push v1-use-cases = de approvals-loop, beide richtingen:** (a) staff-quota-request aangemaakt → push naar approvers; (b) landing-page-guest-request → push naar approvers; (c) request beslist → push naar de aanvrager. Samen met de offline deur is dit de Apple 4.2-"meerwaarde"-verdediging. *Event-reminders/list-lock-warnings vereisen scheduled sends → expliciet later.*
5. **Cloud-CI: Codemagic.** First-class Capacitor-support, gratis 500 macOS-min/mnd, managed iOS-signing + TestFlight/Play-publishing vanuit YAML — geen Mac nodig (Max werkt op Windows). *Alt: GitHub Actions macOS-runners (goedkoper bij volume, maar handmatige fastlane); Ionic Appflow uitgesloten (EOL aangekondigd).*
6. **Review/demo-account: prod `review-login`-route + geïsoleerde demo-venue.** "PLUSONE Demo"-tenant in prod met fake seed-data en één demo-user; route naar model van `src/app/auth/dev-login/route.ts` maar prod-safe: gated op een `REVIEW_LOGIN_CODE`-env-secret (per submissie geroteerd; unset ⇒ 404), hard-gescoped op uitsluitend de demo-user, rate-limited, geaudit. Invite-only + passwordless blijven intact. *Alt: auth-hook met vast OTP voor het demo-adres = magic string in het auth-pad, moeilijker te scopen.*
7. **Deep links blokkeren auth niet.** Native login = het bestaande getypte 6-cijfer-OTP, volledig in-webview. Universal links / app links (AASA + `assetlinks.json` op het Vercel-domein) zijn ship-time-polish zodat magic-link/invite-mails de app openen (S4).
8. **`android/` + `ios/` worden gecommit in de repo.** Standaard Capacitor-praktijk; onder het remote-URL-model is de churn minimaal.

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

- **RLS:** owner-only (`user_id = auth.uid()`) op alle verbs; pgTAP allowed + denied per rol.
- **Remote logout invalideert push** (eis uit de epic): geen cross-schema-FK naar `auth.sessions`; in plaats daarvan de bestaande RPC's **`revoke_own_session` + `admin_revoke_session`** (`src/features/auth/session-actions.ts`) uitbreiden met `delete from push_tokens where session_id = …`.
- **Hygiëne:** prune op FCM-`UNREGISTERED`-responses + pg_cron-TTL-sweep (`last_seen_at` > 90 dagen). Bewust **niet** in de audit-trigger-set (device-plumbing, geen domeindata) — vastleggen in de spec-decision-table.
- **Outbox:** `notification_outbox` (payload, doelgroep-query-resultaat, status, attempts, last_error); AFTER-triggers op `quota_requests` en `guest_requests` vullen hem; pg_net roept de Edge Function; pg_cron veegt retryables.
- **Client:** runtime-adapterselectie in `provider.ts` — `Capacitor.isNativePlatform()` → `CapacitorPushProvider` (via `@capacitor/push-notifications`), anders Noop. Permission-prompt **contextueel, nooit bij launch**: dismissible card op Home/Approvals voor approver-rollen + één toggle in Settings → Notificaties. Registratie via server action die `session_id` uit de JWT stampt; sign-out roept `unregister()` aan **vóór** de bestaande IDB-clear; token-refresh → upsert; notification-tap → approvals-scherm via de po-nav-stack.

## 4. Fasering

Effort in Claude Code-sessies (de werkeenheid van dit project). **NOW** = pre-tractie (goedkoop, houdt optionaliteit), **SHIP** = zodra er tractie is.

### Track M — Max, handmatig, parallel — start direct

| # | Tag | Inhoud |
|---|-----|--------|
| M1 | NOW | **D-U-N-S** aanvragen (gratis, 1–2 wk; welke bedrijfsentiteit PlusOne draagt is een M1-beslissing) → **Apple Developer org-account** (€99/jr). Langste doorlooptijd van het hele traject. |
| M2 | NOW | **Google Play Console org-account** ($25 eenmalig; org vermijdt de personal-account-regel van 12 testers/14 dagen; Play vraagt ook D-U-N-S). |
| M3 | NOW | **Firebase-project** aanmaken (gratis — deblokkeert de echte send-test van N2); **APNs-key** uploaden zodra het Apple-account er is. |
| M4 | SHIP | Store-listing NL, screenshots, privacy nutrition labels (spiegelen de AVG-pagina's), export compliance (HTTPS-only → exempt), Codemagic-account + App Store Connect API-key. |

### Dev-track

| # | Fase | Tag | Effort | Deps | Deliverable |
|---|------|-----|--------|------|-------------|
| N1 | Webview-prep fixes | NOW | 1 | — | Clipboard-fallback (`events.tsx`), `viewport-fit=cover` in de root layout, CSP-wrap-notes, sanity-pass op de CLAUDE.md-Capacitor-checklist. |
| N2 | Push-backend | NOW | 2 | M3 (alleen voor echte send) | Migraties `push_tokens` + `notification_outbox`, AFTER-triggers op `quota_requests`/`guest_requests`, pg_net-wiring, revocatie-RPC-uitbreiding, `supabase/functions/push-dispatch` (FCM v1 + token-pruning), pg_cron-retry, pgTAP, types regenereren. Pipeline **live-maar-slapend**, testbaar tegen gemockte FCM. |
| N3 | Capacitor-scaffold + Android | NOW | 1–2 | N1 | `capacitor.config.ts` met `server.url` = prod, `android/`+`ios/` gecommit, `@capacitor/app` backButton → `history-nav.goBack()`, statusbar/splash-basis, safe-area-check, CSP-fix alleen als de bridge geblokt wordt. **Android-debugbuild op Max' Windows-machine valideert het hele model.** |
| N4 | Deur cold-start-spike | NOW | 1 | N3 | Schriftelijke go/no-go: is remote-URL cold-start-offline acceptabel voor de deur, of bundelen we alleen de (al client-side) deur-route lokaal? Geen productiecode. |
| N5 | Push-client + native adapter | NOW | 1 | N2+N3 | `CapacitorPushProvider`, runtime-selectie, permission-UX, register/unregister-lifecycle, tap-navigatie. Werkende push op Android; iOS volgt in S1. |
| S1 | iOS-build + cloud-CI | SHIP | 1 + Max | M1, M3, N3 | `codemagic.yaml`, managed signing, TestFlight + Play internal track, APNs-via-FCM geverifieerd op echte iPhone. |
| S2 | Icons/splash/store-wiring | SHIP | 1 | N3 | `@capacitor/assets` vanuit het bestaande maskable 512-icoon, store-metadata in repo, screenshots (Max). |
| S3 | Review-login + demo-venue | SHIP | 1 | vóór S5 | Env-gated `review-login`-route + demo-tenant-seedscript, geaudit, security-checklist toegepast. |
| S4 | Universal links / app links | SHIP | 1 | M1, N3 | AASA + `assetlinks.json` route handlers op het domein, `appUrlOpen`-listener → in-app-nav voor `/auth/confirm` + `/e/[slug]`. |
| S5 | Submissie + 4.2-verdediging | SHIP | 1 + Max | alles | Review-notes (push + offline deur + demo-creds), Play data-safety-form, staged rollout, review-responses (reken op iteraties). |

**Totaal ≈ 10–12 sessies** (6–8 NOW, 4–5 SHIP). Kritieke pad naar de store: M1 → S1 → S5; alles onder NOW kan zonder Apple-account behalve de APNs-helft van M3.

## 5. Wat we bewust NIET nu doen

Web-push-adapter · scheduled/reminder-pushes · notification-preferences-matrix (één toggle volstaat) · Tap to Pay (#34 route C — vereist eerst deze store-aanwezigheid) · ops-module-push (#35) · de volledige app lokaal bundelen · billing/IAP/checkout in de app (CLAUDE.md-regel, Apple IAP) · een store-staging-omgeving · widgets/live activities · per-device push-analytics.

## 6. Release-checklist (draft — afvinken in S5)

- [ ] Apple + Play **org**-accounts actief
- [ ] Firebase-project + APNs-key geüpload
- [ ] Push end-to-end geverifieerd op TestFlight + Play internal (alle drie use-cases)
- [ ] Remote logout killt push-tokens (handmatige test)
- [ ] Android-backbutton: retraces de nav-stack, exit alleen op stack-root
- [ ] Safe-area correct op notch-device (statusbar + home-indicator)
- [ ] Deur-cold-start-besluit (N4) geïmplementeerd of expliciet geaccepteerd
- [ ] `REVIEW_LOGIN_CODE` gezet + demo-venue geseed; creds in de review-notes
- [ ] Privacy nutrition labels ↔ AVG-pagina's consistent
- [ ] Export compliance beantwoord (HTTPS-only → exempt)
- [ ] Geen billing-UI bereikbaar in de app
- [ ] NL-listings compleet (beschrijving, screenshots, keywords)
- [ ] Versioning vast: buildnummer = CI-runnummer
- [ ] Offline-banner-gedrag bij mid-session-netwerkverlies gecheckt in de webview
- [ ] CLAUDE.md + spec #37 bijgewerkt; ClickUp-taken dicht

## 7. Kritieke bestanden

- `src/features/notifications/provider.ts` — de seam waar alle push-werk aan hangt
- `src/features/auth/session-actions.ts` — revocatie-RPC's uitbreiden voor token-invalidatie
- `src/components/po/history-nav.ts` — backButton-wiring-target
- `next.config.js` — CSP/headers bij wrap + AASA/assetlinks-serving
- `src/app/auth/dev-login/route.ts` — template voor de prod review-login-route
- `supabase/templates/` — e-mail-deep-links (`{{ .SiteURL }}`)
- `public/manifest.json` + `public/service-worker.js` — bestaande PWA-shell (blijft; webview registreert de SW gewoon niet als hij niet kan)
