# Store-review login + demo venue (Fase 17 S3, 86ey6bfug)

App Store- en Play-reviewers hebben een werkende login nodig, maar de app is
invite-only + passwordless en `/auth/dev-login` is hard non-prod-gated. Oplossing
(capacitor-plan §2 beslissing 6): een geïsoleerde **"PLUSONE Demo"**-venue in prod
met fake data en één demo-user, plus de prod-safe route
[`src/app/auth/review-login/route.ts`](../src/app/auth/review-login/route.ts).

## Hoe het werkt

- `GET /auth/review-login`: codeformulier (statische HTML, geen JS).
- `POST /auth/review-login`: de code gaat in de **form body**, nooit in de URL.
  Bij een match wordt de sessie van de demo-user gezet en gaat de reviewer naar `/app`
  (eerst de consent-gate, net als elke andere login).
- **Uit = 404.** `REVIEW_LOGIN_CODE` niet gezet, leeg, alleen spaties of korter dan
  16 tekens: GET en POST geven allebei een lege 404.
- **Eén account, hard vastgelegd.** Het adres `app-review@demo.plus-one.io` is een
  constante in de code (`src/features/auth/review-login.ts`), geen env-var en geen
  request-parameter. `demo.plus-one.io` heeft geen MX-record, dus niemand kan mail op
  dat adres ontvangen. De bestemming is vast (`/app`); er is geen `next=`.
- **Fail-closed na het inloggen.** De sessie wordt direct weer uitgelogd als het
  account een geverifieerde TOTP-factor heeft, platform-admin is, of lid is van iets
  anders dan precies één venue met de naam "PLUSONE Demo". De serverlog noemt de reden.
- **Rate limit.** 5 pogingen per client per 15 min en 30 per instance, telling vóór de
  codevergelijking. Dit geldt **per serverless-instance** (in-memory): een drempel,
  geen globale limiet. De globale limiet is de Vercel Firewall-regel hieronder. De echte
  bescherming tegen brute force is de entropie van de code (minimaal 16 tekens).
- **Audit.** Elke POST schrijft één gestructureerde serverlogregel:
  `{"event":"review_login","outcome":"success|bad_code|rate_limited|bad_origin|mint_failed|refused","reason":…,"client":"<12 hex>"}`.
  Er staan geen e-mail, code of IP-adres in, alleen een ingekorte gezouten hash
  (`LANDING_IP_SALT`). App-code schrijft nooit naar `audit_log` (CLAUDE.md regel 4).
  GoTrue legt de magic-link-uitgifte en de login daarnaast vast in zijn eigen auth-auditlog.
  Wat de reviewer in de venue doet, komt via de gewone triggers in `audit_log`
  terecht onder het demo-user-id.
- **Service role.** Precies één call: `auth.admin.generateLink` voor het vaste
  demo-adres. Alle checks daarna lopen via de user-scoped client onder RLS.

## Rollen van de demo-user: `admin` + `doorhost`

`admin` omdat de approvals (`approve_*`-RPC's) en de approvals-push admin vereisen.
`doorhost` zodat de Check-in-tab de deur-view van de reviewer is. Geen platform-admin
en geen MFA.

**Rest-risico van `admin`, bewust geaccepteerd.** Wie de code heeft, kan binnen de
demo-venue alles wat een venue-admin kan. Dat omvat ook crew uitnodigen (dan gaat er
echte invite-mail naar een willekeurig adres) en een nieuwe venue aanmaken. Dat laatste
blokkeert de route vanzelf (fail-closed op het aantal memberships) totdat je het
opruimt. Beperk het venster: zet de code alleen tijdens de review en roteer hem per
submissie.

## Eenmalig: seed de demo-venue

Vanuit de **gelinkte main-checkout** (de `.env.local` daar wijst naar prod):

```bash
node scripts/seed-demo-venue.mjs --prod
```

- Het script is idempotent: vaste id's en alleen invoegen wat nog ontbreekt. Een tweede
  run verandert niets, behalve dat de twee demo-events weer naar voren worden geschoven
  (alleen `starts_at`/`ends_at`), zodat ze bij elke submissie in de toekomst liggen.
- Het **reset** de demo-user: alle MFA-factoren weg, rollen terug naar `admin,doorhost`
  en de venuenaam hersteld.
- Het **stopt** (exit 1) als de demo-user platform-admin is of lid is van een andere
  venue. Onderzoek dat en ruim het met de hand op; het script dekt het niet af.
- Het draait nooit in CI (`CI` gezet ⇒ weigert) en weigert een niet-lokale URL zonder `--prod`.
- Waarom `admin.createUser` en niet `inviteUserByEmail`: het demo-adres heeft geen
  mailbox, dus een invite kan alleen bouncen (slecht voor de afzenderreputatie) en de
  link kan niemand gebruiken.

Zet daarna de venue op **`comped`**, zodat de trial-soft-block de reviewer niet
blokkeert. Het script print de exacte SQL; dit is dezelfde runbook als
[`docs/stripe-setup.md`](stripe-setup.md) §5 (als table-owner, in de Studio/SQL-editor):

```sql
update public.subscriptions
set status = 'comped', updated_at = now()
where venue_id = 'de300000-0000-7000-8000-000000000001';
```

## Per submissie: code zetten, roteren, uitzetten

1. Genereer een nieuwe code die de reviewer kan overtypen (~82 bits):
   `node -e "const a='abcdefghjkmnpqrstuvwxyz23456789';const b=require('crypto').randomBytes(16);console.log([...b].map(x=>a[x%a.length]).join('').match(/.{4}/g).join('-'))"`
   (zonder `0/o/1/l/i`). Streepjes tellen mee; de reviewer moet ze meetypen.
2. Vercel → project `plus-one` → Settings → Environment Variables → `REVIEW_LOGIN_CODE`
   (alleen **Production**, type Sensitive). Redeploy, want env-vars gelden pas na een
   nieuwe deploy.
3. Draai het seedscript opnieuw (events naar voren, MFA-reset).
4. Zet in de review-notes: de URL `https://app.plus-one.io/auth/review-login` en de code.
5. **Na goedkeuring of afwijzing:** verwijder `REVIEW_LOGIN_CODE` en redeploy. De route
   is dan weer een 404. Een oude code werkt nooit meer zodra de waarde veranderd of
   weg is.
6. Sessies die een reviewer al heeft, blijven geldig totdat ze verlopen. Wil je ze direct
   intrekken, gebruik dan de sessielijst/remote logout van de demo-user.

Controleer ook dat `LANDING_IP_SALT` in prod gezet is. De route gebruikt die salt voor
de client-hash en faalt (500) zonder.

## Vercel Firewall-regel (globale rate limit): HANDMATIG

Zelfde aanpak als `/e/*` in [`landing-rate-limit-hardening.md`](landing-rate-limit-hardening.md) punt 2:
Firewall → Add rule → Rate Limiting, pad `/auth/review-login`, **10 requests/min per
IP**, actie Deny. Dit vuurt op de edge vóór Next.js en is de globale limiet die de
per-instance limiter niet kan zijn.

## Lokaal testen

1. `pnpm supabase:start` (of `pnpm db:fresh`) en `node scripts/seed-demo-venue.mjs`
   (lokaal is geen `--prod` nodig).
2. Zet `REVIEW_LOGIN_CODE=abcd-efgh-jkmn-pqrs` in `.env.local` en start `pnpm dev`.
3. Open `http://localhost:7000/auth/review-login` en vul de code in.
