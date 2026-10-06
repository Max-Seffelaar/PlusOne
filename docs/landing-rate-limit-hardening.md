# Landing-form rate-limit hardening (86ey2czr6)

Vervolg op de #28-basis (DB rate limit + honeypot + silent dedup + no
event-enumeration), die al solide is voor de testfase. Deze taak voegt de
resterende lagen toe **vóór het eerste echte publieke event** (geen
pilot-blocker). Headings hieronder gebruiken de PUNTNUMMERS uit de originele
taakomschrijving (1/2/3/4), niet een lokale hernummering — punt 3 (log/alert
bij rate-limit) hoort bij Prod-ready 08 (Sentry, `86ey7q790`) en staat hier
bewust niet bij.

## Punt 1 — Throttle-table cleanup — in code, geen actie nodig

`public.landing_request_throttle` groeide ongelimiteerd (elke prefix-key
`req:`/`pv:`/`st:`/`if:`/`slug:` + ip_hash krijgt een eigen rij die nooit werd
opgeruimd). Migratie
[`20260812120000_landing_throttle_cleanup_cron.sql`](../supabase/migrations/20260812120000_landing_throttle_cleanup_cron.sql)
voegt `public.cleanup_landing_request_throttle()` toe + een pg_cron-schedule
(uurlijks, verwijdert rijen `updated_at < now() - interval '2 hours'`). Elke
huidige rate-limit-caller draait op een venster van **15 minuten**
(`consume_public_throttle`, `20260706102000` — verhoogd van 10→15 in
`20260625100000`), dus 2 uur laat ruim marge over; een toekomstig venster
moet well onder die 2h-grens blijven (zie de `comment on function
consume_public_throttle` in dezelfde migratie). Zelfde guarded
do-block-patroon als `run_privacy_retention` (20260614230000), dus
`supabase db reset` blijft groen ook waar pg_cron lokaal niet preloaded is.
Getest in `supabase/tests/database/landing_throttle_cleanup.test.sql`.

**Na de eerstvolgende prod-push**: geen verdere actie — de cron-job draait
zichzelf.

## Punt 2 — Vercel Firewall-regel op `/e/*` — HANDMATIG, dashboard-only

Er is geen code-pad hiervoor (Vercel Pro's WAF is dashboard/API-config, niet
`vercel.json`); dit is de enige stap die Max zelf moet zetten.

1. Vercel-dashboard → project → **Firewall** tab.
2. **Add rule** → Rate Limiting.
   - Match: path `/e/*` (of `starts with /e/`).
   - Limit: **~30 requests/min per IP**.
   - Action: **Deny** (of Challenge, als die optie beschikbaar is op het
     huidige plan — Deny is het simpelste startpunt).
3. Deploy/activeer de regel (Firewall-regels gaan meestal direct live, geen
   herdeploy van de app nodig).
4. Dit vuurt op de CDN-edge, vóór Next.js/Supabase — complementeert de
   DB-side rate limit, vervangt hem niet (de DB-limiet blijft de harde
   grens als de firewall-regel ooit uitstaat of wordt aangepast). Het is ook
   de compenserende edge-control voor de junk-token flood die de
   verify-vóór-RPC volgorde in punt 4 hieronder toelaat — zie de comment bij
   die call in `src/features/requests/actions.ts`.

Geen env-vars, geen codewijziging.

## Punt 4 — Cloudflare Turnstile op het aanvraagformulier — code + account-setup

Code is klaar en **keyless-safe** (zelfde stance als de Stripe-stub —
CLAUDE.md §Billing): zonder BEIDE env-vars rendert de widget niet en
verifieert de server alles open, dus lokale dev/CI blijven ongewijzigd
werken. Exact één van de twee env-vars gezet (misconfiguratie, geen bewust
"uit") faalt ook open, luid gelogd — dat brickt de enige publieke funnel niet
op een half afgeronde env-setup.

- Widget: `TurnstileContainer` (widget-container) + een losstaande
  `<Script>`-tag in
  [`src/components/po/landing.tsx`](../src/components/po/landing.tsx) —
  rendert alleen als `NEXT_PUBLIC_TURNSTILE_SITE_KEY` gezet is. Een
  permanent falende script-load (bv. ad-blocker) toont een zichtbare melding
  en houdt de submit-knop disabled — dit is GEEN client-side gate die een
  echte gast zonder uitleg zou stranden; de server is nog steeds de
  autoriteit (zie hieronder).
- Server-verificatie:
  [`src/features/requests/turnstile.ts`](../src/features/requests/turnstile.ts)
  `verifyTurnstileToken`, aangeroepen in
  [`src/features/requests/actions.ts`](../src/features/requests/actions.ts)
  `submitGuestRequest`, vóór de rate-limited RPC (de RPC is consume-on-check,
  dus de volgorde kan niet omgedraaid worden zonder de throttle dubbel te
  laten tellen — zie de comment op die call-site). Verificatie heeft een
  3s-timeout (`AbortSignal.timeout`) en controleert ook `hostname` uit het
  siteverify-antwoord tegen de eigen request-Host (tegen token-farming: een
  geldig token opgelost op een pagina van een aanvaller, met onze publieke
  site key ingebed, wordt dan alsnog geweigerd).
  - **Faalt CLOSED**: een ontbrekend/ongeldig token zodra beide env-vars
    gezet zijn, een genuine reject-verdict van Cloudflare
    (`invalid-input-response`/`timeout-or-duplicate`/`missing-input-response`),
    of een hostname-mismatch.
  - **Faalt OPEN** (luid gelogd): een onbereikbare/tragere siteverify-call,
    een non-200 status, of een infra-codes-only reject
    (`invalid-input-secret`/`internal-error` — een verkeerd/verlopen secret
    mag geen enkele aanvraag blokkeren). De overige lagen (DB rate limit,
    honeypot, silent dedup) staan in beide gevallen nog overeind.
- CSP: `next.config.js` staat `https://challenges.cloudflare.com` toe in
  `script-src`/`connect-src`/`frame-src`, maar **alleen op `/e/*`** (een
  tweede, specifiekere `headers()`-entry ná de globale catch-all — de
  globale CSP blijft strikt, geen Cloudflare-toegang op de rest van de app).

**Wat Max nog moet doen (Cloudflare-account, geen infra-wijziging nodig):**

1. Gratis Cloudflare-account (of bestaand account) → **Turnstile** in het
   dashboard.
2. **Add site**: domain = `app.plus-one.io` (het app-domein: de publieke
   aanvraagpagina `/e/[slug]` draait daar). Widget mode: **Managed**
   (aanbevolen — meestal onzichtbaar voor echte gasten, alleen een
   uitdaging bij verdachte requests).
   **Zet hier NIET `localhost` bij** als domein op dezelfde site: sinds de
   hostname-check hierboven wordt een token dat op `localhost` is opgelost
   toch geweigerd zodra de request in productie draait — dat domein toevoegen
   heropent precies de token-farming-bypass die de hostname-check dichtzet.
   Wil je lokaal met een echte key testen, maak dan een APARTE Turnstile-site
   met `localhost` als domein en gebruik die site's keys alleen in
   `.env.local`, nooit in de Vercel-productie-env.
3. Kopieer de **Site Key** (publiek) en **Secret Key** (privé) naar Vercel
   → Project Settings → Environment Variables:
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   - `TURNSTILE_SECRET_KEY`
4. Redeploy (env-var-wijziging vereist een nieuwe build in Next.js voor de
   `NEXT_PUBLIC_*`-inlining).

Zonder deze twee env-vars blijft de widget onzichtbaar en draait de site
door zoals nu (geen regressie) — dit is dus veilig te mergen vóórdat het
Cloudflare-account bestaat.

## Punt 5 — Raw-PostgREST callers binden aan de throttle — code + eenmalige prod-stap

Gevonden in de onafhankelijke review van PR #379 (2026-10-05). Elke anon-RPC
(`submit_guest_request`, `get_landing_event`, `record_link_pageview`,
`get_request_status`, `get_influencer_stats`) throttlet op
`'<prefix>:' || p_ip_hash`, en `p_ip_hash` komt van de aanroeper. Wie de
publieke anon-key heeft kon `/rest/v1/rpc/...` direct aanroepen met
`p_ip_hash => null` (NULL-key = geen throttle) of met een nieuwe random string
per call (nieuwe bucket per call). Turnstile draait in de server action, dus
een raw caller sloeg die óók over.

Fix (migratie
[`20261006170000_public_throttle_bind_raw_callers.sql`](../supabase/migrations/20261006170000_public_throttle_bind_raw_callers.sql)),
volledig in `consume_public_throttle`:

- Een NULL-key valt in één gedeelde bucket `anon:~untrusted` (direct live).
- De app-server stuurt een server-only geheim mee als header
  `x-plusone-throttle-trust` (`src/features/requests/rpc-trust.ts`). Staat de
  sha256 daarvan in `public.public_throttle_trusted_callers`, dan telt een
  `req`/`pv`/`st`/`if`/`slug`-key alleen per IP-hash voor een request dat het
  geheim meestuurt. Alle andere callers delen één bucket per oppervlak
  (`<prefix>:~untrusted`) met het budget van dat oppervlak; random keys roteren
  levert niets meer op. Deur-WiFi (veel telefoons achter één NAT-IP) houdt
  exact het oude budget: één hash, 15 min / 60.
- Geen rij in de tabel = geen check (lokaal, CI, en prod tot stap 3 hieronder).

**Wat Max moet doen — in deze volgorde (omgekeerd = publieke funnel plat):**

1. Genereer het geheim lokaal: `openssl rand -hex 32`.
2. Vercel → Project Settings → Environment Variables → `PUBLIC_RPC_TRUST_SECRET`
   met scope **Production én Preview, dezelfde waarde**. Redeploy. De
   productie-build weigert zonder deze var (`scripts/hooks/lib/required-env.mjs`),
   dus zet hem **vóór** het mergen van deze PR.
   Waarom Preview ook: er is geen staging, previews praten met de prod-database,
   en die vertrouwt alleen geheimen waarvan de hash in
   `public_throttle_trusted_callers` staat. Een preview zonder (bekend) geheim
   deelt na stap 3 de `<prefix>:~untrusted`-buckets met raw callers — lege
   landingspagina's en `rate_limited` bij testen, wat eruitziet als een bug in
   de PR. Wil je toch een eigen Preview-geheim (bv. om het prod-geheim niet in
   preview-builds te hebben), voeg dan in stap 3 een tweede rij toe met label
   `vercel-preview-…`.
3. Pas als die deploy live is: in de Supabase SQL-editor (prod) de hash
   toevoegen. Bereken de hex-digest lokaal, zodat het geheim zelf nooit in
   SQL-history belandt:
   ```bash
   printf '%s' "$SECRET" | sha256sum
   ```
   ```sql
   insert into public.public_throttle_trusted_callers (secret_sha256, label)
   values (decode('<64-hex-digest>', 'hex'), 'vercel-prod-2026-10');
   ```
4. Check: `/e/<een open slug>` laadt nog; een directe call zonder header
   (`curl .../rest/v1/rpc/get_landing_event` met de anon-key en een random
   `p_ip_hash`) geeft na 60 calls in 15 min een lege array.

**Kill switch:** `delete from public.public_throttle_trusted_callers;` — direct
terug naar het oude gedrag (behalve de NULL-key-fix).
**Rotatie:** nieuwe rij toevoegen → nieuwe env-waarde deployen → oude rij
verwijderen. Meerdere rijen tegelijk geldig is bedoeld.
