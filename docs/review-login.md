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
- **Uit = 404, en het venster sluit vanzelf.** De route staat alleen aan als
  `REVIEW_LOGIN_CODE` minstens 26 letters/cijfers heeft (streepjes tellen niet mee;
  130 bits) **én** `REVIEW_LOGIN_EXPIRES_AT` een ISO-tijdstip met tijdzone is dat in de
  toekomst ligt en hooguit 60 dagen vooruit. Anders geven GET en POST een lege 404.
  Na het verlopen hoef je niets uit te zetten.
- **Eén account, hard vastgelegd.** Het adres `app-review@demo.plus-one.io` is een
  constante in de code (`src/features/auth/review-window.ts`), geen env-var en geen
  request-parameter. `demo.plus-one.io` heeft geen MX-record, dus niemand kan mail op
  dat adres ontvangen. De bestemming is vast (`/app`); er is geen `next=`.
- **Fail-closed na het inloggen.** De sessie wordt direct weer uitgelogd als het
  account een geverifieerde TOTP-factor heeft, platform-admin is, of niet lid is van
  precies één venue: de demo-venue op **vast id** `de300000-0000-7000-8000-000000000001`
  (de naam is alleen voor weergave). De serverlog noemt de reden.
- **Eén demo-sessie tegelijk.** Na een geslaagde login worden alle *andere* sessies van
  de demo-user uitgelogd (`scope: 'others'`). Een uitgelekte oude sessie sterft bij de
  volgende review-login.
- **Sessies sterven met het venster.** Is het venster dicht (verlopen, of de code
  weg), dan stuurt de `/app`-layout een demo-sessie naar `/auth/review-login/end`. Die
  logt alle demo-sessies uit (`scope: 'global'`) en gaat naar `/login`. Voor andere
  users is dit alleen een e-mailvergelijking, zonder query. Er is geen cron en geen
  migratie. De IndexedDB/SW-cache van dat toestel wordt hierbij niet gewist (dat doet
  alleen `signOutDevice` in de browser); het gaat om fake demo-data.
- **Rate limit, per client.** Maximaal 5 pogingen per client per 15 min, geteld vóór de
  codevergelijking. Er is **geen** globale limiet in de app: die zou een aanvaller met
  veel IP's de reviewer laten buitensluiten. De limiter is in-memory, dus per
  serverless-instance. Bovenop de per-client limiet komen de Vercel Firewall-regel en,
  als echte grens, de 130 bits van de code.
- **Audit.** Elke POST, en elke sessie die de end-route beëindigt, schrijft één
  gestructureerde serverlogregel:
  `{"event":"review_login","outcome":"success|bad_code|rate_limited|bad_origin|mint_failed|refused|session_ended","reason":…,"client":"<12 hex>"}`.
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
opruimt. Het venster houdt dit kort: hooguit 60 dagen, en daarna sterft elke demo-sessie.

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

## Per submissie: code + vervaldatum zetten

1. Genereer een nieuwe code (28 base32-tekens = 140 bits, in groepjes van 4):
   `node -e "const a='abcdefghijklmnopqrstuvwxyz234567';console.log([...require('crypto').randomBytes(28)].map(x=>a[x%32]).join('').match(/.{4}/g).join('-'))"`
   (256 is deelbaar door 32, dus zonder modulo-bias). De streepjes horen bij de code; de reviewer typt ze mee.
2. Vercel → project `plus-one` → Settings → Environment Variables (alleen
   **Production**, type Sensitive):
   - `REVIEW_LOGIN_CODE` = de code
   - `REVIEW_LOGIN_EXPIRES_AT` = einde van het reviewvenster, ISO met zone, hooguit 60
     dagen vooruit, bv. `2026-11-15T23:59:00+01:00`

   Redeploy, want env-vars gelden pas na een nieuwe deploy.
3. Draai het seedscript opnieuw (events naar voren, MFA-reset).
4. Zet in de review-notes de URL `https://app.plus-one.io/auth/review-login` en de code.

Dat is alles. Na de vervaldatum is de route een 404 en eindigt elke demo-sessie bij
het volgende `/app`-verzoek; opruimen is niet nodig. Een oude code werkt niet meer
zodra je een nieuwe zet. Wil je eerder stoppen, verwijder dan een van de twee
env-vars en redeploy; ook dan eindigen de demo-sessies.

Controleer ook dat `LANDING_IP_SALT` in prod gezet is. De route en de end-route gebruiken
die salt voor de client-hash en falen (500) zonder.

## Vercel Firewall-regel (globale rate limit): HANDMATIG

Zelfde aanpak als `/e/*` in [`landing-rate-limit-hardening.md`](landing-rate-limit-hardening.md) punt 2:
Firewall → Add rule → Rate Limiting, pad `/auth/review-login`, **10 requests/min per
IP**, actie Deny. Dit vuurt op de edge vóór Next.js en is de globale limiet die de
per-instance limiter niet kan zijn.

## Lokaal testen

1. `pnpm supabase:start` (of `pnpm db:fresh`) en `node scripts/seed-demo-venue.mjs`
   (lokaal is geen `--prod` nodig).
2. Zet in `.env.local` `REVIEW_LOGIN_CODE=abcd-efgh-ijkm-nopq-rstu-vwxy-z234` en
   `REVIEW_LOGIN_EXPIRES_AT=<over een week, ISO met Z>`, en start `pnpm dev`.
3. Open `http://localhost:7000/auth/review-login` en vul de code in.
