# Store-review login + demo venue (Fase 17 S3, 86ey6bfug)

App Store- en Play-reviewers hebben een werkende login nodig, maar de app is
invite-only + passwordless en `/auth/dev-login` is hard non-prod-gated. Oplossing
(capacitor-plan §2 beslissing 6): een geïsoleerde **"PlusOne Demo"**-venue in prod
met fake data en één demo-user, plus de prod-safe route
[`src/app/auth/review-login/route.ts`](../src/app/auth/review-login/route.ts).

## Hoe het werkt

- `GET /auth/review-login`: codeformulier (statische HTML, geen JS).
- `POST /auth/review-login`: de code gaat in de **form body**, nooit in de URL.
  Bij een match wordt de sessie van de demo-user gezet en gaat de reviewer naar `/app`
  (eerst de consent-gate, net als elke andere login).
- **Elke andere methode** (OPTIONS/PUT/PATCH/DELETE) geeft dezelfde lege 404.
- **Uit = 404, en het venster sluit vanzelf.** De route staat alleen aan als
  `REVIEW_LOGIN_CODE` minstens 26 letters/cijfers heeft (streepjes tellen niet mee;
  130 bits) **én** `REVIEW_LOGIN_EXPIRES_AT` een ISO-tijdstip met tijdzone is dat in de
  toekomst ligt en hooguit 60 dagen vooruit. Anders geven GET en POST een lege 404.
  Na het verlopen hoef je niets uit te zetten.
- **Eén account, hard vastgelegd.** Het adres `app-review@demo.plus-one.io` is een
  constante in de code (`src/features/auth/review-window.ts`), geen env-var en geen
  request-parameter. `demo.plus-one.io` heeft geen MX-record, dus niemand kan mail op
  dat adres ontvangen. De bestemming is vast (`/app`); er is geen `next=`.
- **Fail-closed, vóór er een cookie bestaat.** De route verifieert de token op een
  client zonder cookies en doet daar alle checks. Pas als alles klopt, gaan de
  sessie-cookies naar de browser; een weigering hangt dus niet af van een geslaagde
  sign-out. Geweigerd wordt als:
  - het account niet zowel het vaste **user-id** `de300000-0000-7000-8000-00000000a001`
    als het demo-adres heeft;
  - er een geverifieerde TOTP-factor is;
  - het account platform-admin is;
  - het niet lid is van precies één venue: de demo-venue op **vast id**
    `de300000-0000-7000-8000-000000000001` (de naam is alleen voor weergave);
  - de rollen van die membership niet precies `admin,doorhost` zijn (`roles_changed`).
    Deze check komt vóór de isolatie-check: alleen als admin ziet de demo-user de
    andere leden en de invites van zijn venue, en een admin kan zijn eigen rij
    wijzigen;
  - de demo-venue niet geïsoleerd is: er is nog een ander lid, of er staat een open
    invite in die venue of naar het demo-adres (`venue_not_isolated`).

  De serverlog noemt de reden.
- **Het e-mailadres ligt vast.** `updateEmailAction` weigert de demo-account (op id
  of adres). Dat is belt and braces bovenop Supabase's **Secure email change**: een
  code-houder kan GoTrue ook direct aanroepen (`PUT /auth/v1/user`), en dan houdt
  alleen de dubbele bevestiging via het mailboxloze demo-adres de wijziging tegen.
  Controleer dus dat die instelling in prod aan staat (zie hieronder).
- **Eén demo-sessie tegelijk.** Na een geslaagde login worden alle *andere* sessies van
  de demo-user uitgelogd (`scope: 'others'`). Een uitgelekte oude sessie sterft bij de
  volgende review-login.
- **Sessies sterven met het venster.** Is het venster dicht (verlopen, of de code
  weg), dan logt de **middleware** (`updateSession`) een demo-sessie (herkend op id óf
  adres) bij het eerstvolgende verzoek uit, op elke route die de middleware dekt: ook
  `/door/*` en server actions, niet alleen `/app`. Dat is een globale sign-out
  (`scope: 'global'`) en een 303 naar `/login`; lukt de sign-out niet, dan een 503 in
  plaats van een redirect-lus. De `/app`-layout heeft dezelfde check (via
  `/auth/review-login/end`) als tweede laag. Voor andere users is het één
  id/e-mailvergelijking op de user die de middleware al had, zonder extra query. Er is
  geen cron en geen migratie.
- **Restrisico:** een pure-API-client die de app nooit bezoekt (alleen PostgREST/Realtime
  met de JWT, en de refresh-token direct bij GoTrue), houdt zijn sessie tot de volgende
  review-login (`scope: 'others'`) of tot je `node scripts/seed-demo-venue.mjs --prod --end-review`
  draait. De IndexedDB/SW-cache van dat toestel wordt hierbij niet gewist (dat doet
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
demo-venue alles wat een venue-admin kan, behalve uitnodigen (zie hieronder). Het
venster houdt dit kort: hooguit 60 dagen, en daarna sterft elke demo-sessie.

**Het demo-account kan geen venue maken en de demo-venue kan niemand uitnodigen —
beide in de database.** De route zou het
alleen kunnen *detecteren*, niet blokkeren: een code-houder kan een venue maken, daar
een echt adres als admin uitnodigen en dan zijn eigen membership verwijderen, waarna
het aantal memberships weer klopt. Daarom weigert `create_venue_with_owner` het vaste
demo-id met 42501 (migratie `20260925130000_review_demo_guard.sql`, pgTAP
`review_demo_guard.test.sql`), wie de RPC ook aanroept. `createVenueAction` weigert
het ook, alleen voor een nette foutmelding. Als tripwire stopt het seedscript als er
`audit_log`-rijen zijn met het demo-id als actor in een andere venue dan de demo-venue.

Die guard keyt alleen op het demo-id. Een adres dat de demo-admin uitnodigt is een
gewoon account en zou wél een venue kunnen maken (de tenant ontstaat dan één hop
later). Daarom weigert een `before insert`-trigger op `invites` elke invite in de
demo-venue met 42501, voor iedereen, service role incluis (migratie
`20260925130100_review_demo_no_invites.sql`, pgTAP `review_demo_no_invites.test.sql`).
Zonder invite kan `accept_pending_invites` niemand aan de demo-venue toevoegen. Er is
geen legitiem pad dat in de demo-venue uitnodigt: de seed maakt de ene membership direct
aan.

Een directe membership-insert (RLS `venue_memberships_insert`: een admin voegt een
*bestaand* account toe, zonder invite) of een update die de eigen rij naar een ander
`user_id` verhangt, zou de demo-venue niet-geïsoleerd maken: de volgende review-login
weigert dan met `venue_not_isolated` en de reviewer staat buiten. Hetzelfde via crew:
`event_organizers_insert_admin` zet een bestaand account op een event (`assignOrganizer`).
Daarom weigert migratie `20260925150000_demo_venue_no_new_members.sql` (pgTAP
`review_demo_no_new_members.test.sql`) met 42501, voor iedereen, service role incluis:
- `venue_memberships` insert/update (`venue_id`, `user_id`) van een rij in de demo-venue
  voor iemand anders dan de demo-user (de seed-upsert van de eigen rij blijft werken);
- elke `event_organizers`-insert op een event van de demo-venue (de seed maakt geen crew).
`assignOrganizer` weigert het demo-account ook, voor een nette melding.

De uitnodigingsflow voor externe crew (`inviteExternalCrew` in
`src/features/events/actions.ts`) schrijft géén `invites`-rij: die maakt via de service
role direct een account aan, dus de trigger ziet hem niet. Daar is de app-check op het
demo-account de stop (vóór elke read of service-role-call); `resendCrewInvite` weigert
het demo-account ook.

## Wat de reviewer ziet

Elke weigering noemt het demo-account, zodat een reviewer het leest als bewuste beperking
en niet als bug (guideline 2.1). De copy staat in de catalogus (`t.auth.demo*` in
`src/lib/i18n/surfaces/auth.ts`):

De reviewer ziet de weigering **vooraf**: de knop blijft zichtbaar maar is inert
(`RefusedAction` / `disabled`), met de melding als `Note` eronder. Er opent geen
formulier of sheet dat pas bij verzenden faalt. De server-actions en DB-triggers blijven
de grens; de UI-check is alleen presentatie.

| Actie | UI-ingang (vooraf geweigerd) | Server / DB | Melding |
| --- | --- | --- | --- |
| Iemand uitnodigen (team) | Team: "Invite" + header-"+", beide "Resend"-chips | `inviteUserAction`, `resendInviteAction`; `invites`-trigger | "Invites are turned off for the demo account." |
| Crew toevoegen (e-mail of terugkerend) | Event → Crew: "Add crew" (sheet opent niet) | `inviteExternalCrew`, `resendCrewInvite`, `assignOrganizer`; `event_organizers`-trigger | "Invites are turned off for the demo account." |
| Nieuwe venue maken | Venue-switcher ("+" en "New venue"), Venue settings "New venue", deeplink `/app/venues/new` | `createVenueAction`; `create_venue_with_owner` | "The demo account can't create venues." |
| E-mailadres wijzigen | Profiel: e-mail read-only | `updateEmailAction` | "The demo account's email can't be changed." |

Wie het demo-account is, leest de client uit twee onafhankelijke bronnen (elk volstaat):
de `demoAccount`-vlag van de `/app`-layout én het user-id van de live identity
(`useIsDemoAccount`, `src/components/po/app-shell-data.tsx`). Team- en crew-ingangen zijn
ook inert voor iedereen die in de demo-venue werkt (platform-support), want de DB weigert
daar elk nieuw lid (`useIsDemoVenue`).

Plak dit in de App Review-notes (App Store Connect) en de Play-reviewnotities, onder de
review-code:

> Demo account: full access to guest lists, approvals and the door check-in. Creating
> venues, inviting people and changing the account e-mail are disabled for this account.

## Eenmalig: seed de demo-venue

Vanuit de **gelinkte main-checkout** (de `.env.local` daar wijst naar prod):

```bash
node scripts/seed-demo-venue.mjs --prod
```

- Het script is idempotent: vaste id's en alleen invoegen wat nog ontbreekt. Een tweede
  run verandert niets, behalve dat de twee demo-events weer naar voren worden geschoven
  (alleen `starts_at`/`ends_at`), zodat ze bij elke submissie in de toekomst liggen.
- Het **reset** de demo-user en de venue:
  - alle MFA-factoren worden verwijderd;
  - `mfa_snooze_until = 'infinity'`, dus nooit een MFA-nudge op het gedeelde account;
  - de rollen gaan terug naar `admin,doorhost`;
  - de venuenaam wordt hersteld;
  - open invites in de demo-venue of naar het demo-adres worden verwijderd.
  - de publieke aanvraagpagina van de demo-events staat uit (`landing_active = false`):
    de slugs staan in een publieke repo en een open formulier zou echte PII in een
    demo-tenant laten landen. De reviewer gebruikt de geseede aanvragen.
- De demo-user wordt aangemaakt met het vaste user-id. Bestaat het adres onder een
  ander id, of het id onder een ander adres, dan **stopt** het script.
- Het **stopt** (exit 1) als:
  - de demo-user platform-admin is;
  - de demo-user lid is van een andere venue;
  - de demo-venue andere leden heeft. Met `--reset-members` worden die leden
    verwijderd in plaats van dat het script stopt. In beide gevallen toont het ook
    de venues waarvan `settings.onboarding.created_by` zo'n lid is (alleen tonen,
    nooit verwijderen), zodat je ziet of er een tenant is ontstaan. `--reset-members`
    verwijdert alleen de membership, niet het account of zijn venue: dat beslis je zelf.
  - er `audit_log`-rijen zijn met het demo-id als actor en een andere `venue_id` dan
    de demo-venue (tripwire: de code-houder heeft ergens anders iets gedaan).

  Onderzoek zo'n stop eerst; een extra lid betekent meestal dat een code-houder
  iemand heeft uitgenodigd.
- `--end-review` doet alléén de globale sign-out van alle demo-sessies en seedt niets
  (zie "Per submissie").
- Het print hoeveel live sessies de demo-user heeft (daarvoor is
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` in de env nodig).
- Een slug-conflict met een echte venue of een echt event geeft een duidelijke
  melding (23505) in plaats van een ruwe constraint-fout.
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

Na de vervaldatum is de route een 404 en eindigt elke demo-sessie bij het volgende
verzoek aan de app (middleware). Een oude code werkt niet meer zodra je een nieuwe zet.
Wil je eerder stoppen, verwijder dan een van de twee env-vars en redeploy; ook dan
eindigen de demo-sessies.

**Als een submissie afgesloten is** (goedgekeurd of afgewezen), trek alle demo-sessies
in, ook die van een client die alleen de API gebruikt:

```bash
node scripts/seed-demo-venue.mjs --prod --end-review
```

Dat doet alleen een globale sign-out van de demo-user (via een probe-sessie met de
anon-key, dus `NEXT_PUBLIC_SUPABASE_ANON_KEY` moet in de env staan) en seedt niets.

Controleer in het **prod-Supabase-dashboard** (project `tolxwgqhppdcvnogdpel` →
Authentication → Sign In / Providers → Email) dat **Secure email change AAN** staat.
Zonder die instelling kan een code-houder het demo-adres via de GoTrue-API naar een
eigen mailbox omzetten; de check in `updateEmailAction` dekt alleen de app.

Controleer ook dat `LANDING_IP_SALT` in prod gezet is. De login-route gebruikt die salt
voor de client-hash en faalt (500) zonder; de end-route logt dan `no-client` en werkt door.

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
