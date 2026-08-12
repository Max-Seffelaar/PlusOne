# Landing-form rate-limit hardening (86ey2czr6)

Vervolg op de #28-basis (DB rate limit + honeypot + silent dedup + no
event-enumeration), die al solide is voor de testfase. Deze taak voegt de
resterende lagen toe **vóór het eerste echte publieke event** (geen
pilot-blocker). Puntnummers zoals in de taakomschrijving; punt 3
(log/alert bij rate-limit) hoort bij Prod-ready 08 (Sentry, `86ey7q790`) en
staat hier niet.

## 1. Throttle-table cleanup — in code, geen actie nodig

`public.landing_request_throttle` groeide ongelimiteerd (elke prefix-key
`req:`/`pv:`/`st:`/`if:` + ip_hash krijgt een eigen rij die nooit werd
opgeruimd). Migratie
[`20260812120000_landing_throttle_cleanup_cron.sql`](../supabase/migrations/20260812120000_landing_throttle_cleanup_cron.sql)
voegt `public.cleanup_landing_request_throttle()` toe + een pg_cron-schedule
(uurlijks, verwijdert rijen `updated_at < now() - interval '2 hours'` — ruim
voorbij elk huidig rate-limit-venster). Zelfde guarded do-block-patroon als
`run_privacy_retention` (20260614230000), dus `supabase db reset` blijft
groen ook waar pg_cron lokaal niet preloaded is. Getest in
`supabase/tests/database/landing_throttle_cleanup.test.sql`.

**Na de eerstvolgende prod-push**: geen verdere actie — de cron-job draait
zichzelf.

## 2. Vercel Firewall-regel op `/e/*` — HANDMATIG, dashboard-only

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
   grens als de firewall-regel ooit uitstaat of wordt aangepast).

Geen env-vars, geen codewijziging.

## 3. Cloudflare Turnstile op het aanvraagformulier — code + account-setup

Code is klaar en **keyless-safe** (zelfde stance als de Stripe-stub —
CLAUDE.md §Billing): zonder env-vars rendert de widget niet en verifieert de
server alles open, dus lokale dev/CI blijven ongewijzigd werken.

- Widget: `TurnstileWidget` in
  [`src/components/po/landing.tsx`](../src/components/po/landing.tsx) —
  rendert alleen als `NEXT_PUBLIC_TURNSTILE_SITE_KEY` gezet is.
- Server-verificatie:
  [`src/features/requests/turnstile.ts`](../src/features/requests/turnstile.ts)
  `verifyTurnstileToken`, aangeroepen in
  [`src/features/requests/actions.ts`](../src/features/requests/actions.ts)
  `submitGuestRequest`, vóór de rate-limited RPC. Faalt **open** bij een
  onbereikbare siteverify-call (Cloudflare-outage mag geen aanvragen
  blokkeren — de overige lagen staan nog overeind), faalt **closed** bij een
  ontbrekend/ongeldig token zodra een secret is geconfigureerd.
- CSP: `next.config.js` staat `https://challenges.cloudflare.com` toe in
  `script-src`/`connect-src`/`frame-src`.

**Wat Max nog moet doen (Cloudflare-account, geen infra-wijziging nodig):**

1. Gratis Cloudflare-account (of bestaand account) → **Turnstile** in het
   dashboard.
2. **Add site**: domain = het prod-domein (plus `localhost` als je ook
   lokaal met een echte key wilt testen). Widget mode: **Managed**
   (aanbevolen — meestal onzichtbaar voor echte gasten, alleen een
   uitdaging bij verdachte requests).
3. Kopieer de **Site Key** (publiek) en **Secret Key** (privé) naar Vercel
   → Project Settings → Environment Variables:
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   - `TURNSTILE_SECRET_KEY`
4. Redeploy (env-var-wijziging vereist een nieuwe build in Next.js voor de
   `NEXT_PUBLIC_*`-inlining).

Zonder deze twee env-vars blijft de widget onzichtbaar en draait de site
door zoals nu (geen regressie) — dit is dus veilig te mergen vóórdat het
Cloudflare-account bestaat.
