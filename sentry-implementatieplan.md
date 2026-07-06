# Sentry-implementatieplan — error monitoring & alerting

> **ClickUp**: [86ey3x3af — [Infra] Sentry implementeren](https://app.clickup.com/t/86ey3x3af)
> **Status**: plan definitief (2026-07-06), implementatie nog niet gestart.
> **Voor de implementator (AI-model of mens)**: dit doc is self-contained. Alle designbeslissingen zijn al genomen en tegen de codebase geverifieerd — voer het plan uit zoals het er staat, wijk alleen af als de code aantoonbaar veranderd is sinds 2026-07-06 (check dan de "Geverifieerde codebase-feiten" hieronder opnieuw). Fase 7 (handmatige stappen) is voor Max; alles daarbuiten is code.

## Doel

Sentry (`@sentry/nextjs`) integreren voor error monitoring, leesbare stack traces, release-tracking en alerting — los van Supabase-logs (die dekken alleen de backend: geen frontend-errors, geen source maps, geen alerts). Harde randvoorwaarden uit de taak:

1. **PII-proof**: gastdata (namen, e-mails, telefoonnummers) mag NOOIT in een error-payload belanden — wij zijn verwerker van gastdata van venues.
2. **Kosten laag**: gratis Developer-plan, lage trace-sample-rate, geen session replay in v1.
3. **Bruikbare errors**: een event zonder context ("something went wrong") is waardeloos — elk event moet scherm, venue, datastroom en leesbare stack meedragen (zie "Diagnostische context").
4. **Capacitor-safe** (CLAUDE.md #37): alles moet later ongewijzigd in de remote-URL webview-wrap werken.

## Geverifieerde codebase-feiten (2026-07-06 — vertrouw deze, her-verifieer alleen bij twijfel)

- Next.js 15.5.x (App Router), React 19, pnpm, build = plain `next build` (webpack, géén turbopack-flag — zo houden).
- Er bestaat **geen** `instrumentation.ts`, `instrumentation-client.ts`, `global-error.tsx` of `error.tsx` — schone lei.
- `next.config.js` (CommonJS) zet een strikte CSP via `headers()`: prod `connect-src 'self' https://*.supabase.co wss://*.supabase.co`. `next-pwa` is uitgecomment; er draait een handmatige `public/service-worker.js` (alleen production, cachet alleen GET's — raakt de Sentry-tunnel niet).
- `src/middleware.ts` = auth-gate op edge-runtime (geen `runtime`-export = edge), matcher dekt alle niet-statische routes → **de tunnel-route moet expliciet worden uitgesloten**, anders 307't elke envelope naar `/login`.
- Route handlers (`src/app/auth/{callback,confirm,dev-login}/route.ts`) draaien allemaal Node; nergens `runtime = 'edge'`.
- Server actions gooien **nooit** voor verwachte fouten — ze retourneren `{ ok: false, code, message }` (`MutationError` uit `src/lib/db-errors.ts`). Onverwachte exceptions gooien wél. DB-meldingen zijn Nederlands en kúnnen gastnamen bevatten (m.n. Postgres `Key (col)=(value)`-details bij 23505).
- `src/features/po/PoLiveProvider.tsx`: maakt de QueryClient (retry: 1, geen globale onError) en heeft `identity: PoIdentity` met `userId`, `venueId`, `roles` — precies wat we voor Sentry-context nodig hebben.
- Deur-outbox (`src/features/door/outbox/replay.ts`): classificeert fouten naar statusvelden (45xxx = business, netwerk = pending/retry) — allemaal *expected*, dus daar niets capturen.
- Env-conventie: platte namen (`NEXT_PUBLIC_SUPABASE_URL` etc.); `.env.example` is deels stale (de `_STAGING`/`_PROD`-namen en `NEXT_PUBLIC_ENV` worden NIET gebruikt). `scripts/dev-env.mjs` schrijft `.env.local` alleen als die nog niet bestaat (clobbert dus geen Sentry-vars).
- CI (`.github/workflows/ci.yml`): lint → type-check → `pnpm test` (vitest, node-env; bevat de secret-grep guard `src/lib/supabase/service-confinement.test.ts`) → pgTAP → `pnpm build` met placeholder-envs. **De build moet slagen zonder `SENTRY_AUTH_TOKEN`.**
- De hele po-app leeft op één URL (`/app`) met een interne nav-stack in `src/components/po/app.tsx` — standaard route-breadcrumbs zeggen dus niets over het actieve scherm.

## Designbeslissingen (genomen — niet heropenen)

| # | Beslissing | Waarom |
|---|---|---|
| D1 | **EU-dataregio** (`de.sentry.io`, Frankfurt) | AVG-posture: Supabase eu-west-1, Vercel fra1. Org bij aanmaak op datalocatie "European Union" zetten. DSN-host wordt `…ingest.de.sentry.io`. |
| D2 | **tunnelRoute `/monitoring`**, CSP níét verbreden | Envelopes gaan same-origin → strikte CSP blijft onaangeraakt, ad-blocker-proof, en de latere Capacitor remote-URL-webview post naar dezelfde origin. Kost één Vercel-function-invocation per envelope — verwaarloosbaar bij dit volume. Gevolg: `/monitoring` MOET uit de middleware-matcher (fase 1.3). |
| D3 | **Geen session replay in v1** | Replay neemt de DOM op = gastnamen in beeld. Gastdata is van de venues (wij zijn verwerker; gasten hebben óns privacybeleid nooit gezien). Zie "Replay als v2-optie" onderaan voor de voorwaarden waaronder het later wél kan. |
| D4 | **`sendDefaultPii: false` overal** + eigen scrub-laag (fase 3) | Belt-and-braces: SDK stuurt geen IP's/cookies/headers, en onze `beforeSend` redigeert wat er tóch doorheen zou glippen. |
| D5 | **Sample rates**: errors `1.0`, traces `0.05` alleen op production, `enabled: Boolean(dsn)` | Elke error telt; 5% tracing geeft genoeg p75-signaal tegen ~nul kosten. Geen DSN (lokaal/CI) = SDK volledig dormant. |
| D6 | **Alerts: e-mail only** (gratis Developer-plan) | Keuze Max 2026-07-06. Slack vereist het Team-plan ($26/mnd) — latere upgrade-optie. |
| D7 | **Release-tracking via de Sentry⇄Vercel marketplace-integratie** | Zet `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` automatisch in Vercel en koppelt deploys aan releases; `withSentryConfig` pakt `VERCEL_GIT_COMMIT_SHA` als release-naam. Geen handmatige release-config in code. |
| D8 | **Environment-detectie via `NEXT_PUBLIC_VERCEL_ENV ?? NODE_ENV`** | `NEXT_PUBLIC_ENV` uit `.env.example` is stale en wordt nergens gebruikt. `NEXT_PUBLIC_VERCEL_ENV` (production/preview/development) is een Vercel system-env — vereist dat "Automatically expose System Environment Variables" aan staat (default aan; Max checkt in fase 7). |
| D9 | **`@sentry/nextjs@^10`** (nieuwste 10.x bij installatie) | v10 ondersteunt Next 15 + React 19 volledig. `instrumentation-client.ts` vereist Next ≥15.3 — we zitten op 15.5.x. |
| D10 | **Server actions blijven onaangeraakt** | Verwachte fouten = `MutationError`-returns (nooit rapporteren = geen noise, geen PII). Onverwachte throws bubbelen naar Next → `onRequestError` → automatisch gecaptured. Nul wijzigingen in de 13 `actions.ts`-files. |

---

## Fase 1 — Dependency + build-config

### 1.1 Installeren

```bash
pnpm add @sentry/nextjs@^10
```

### 1.2 `next.config.js` — `withSentryConfig`-wrap

Alles in het bestand blijft zoals het is (CSP onaangeraakt, per D2); alleen de export onderaan verandert:

```js
const { withSentryConfig } = require('@sentry/nextjs');

// ... bestaande nextConfig ongewijzigd ...

module.exports = withSentryConfig(nextConfig, {
  // Geen secrets; hardcoded fallbacks zodat CI/lokale builds geen env nodig
  // hebben. De Vercel-integratie injecteert SENTRY_ORG/SENTRY_PROJECT — env wint.
  org: process.env.SENTRY_ORG || 'REPLACE_ME_ORG_SLUG',        // fase 7.2
  project: process.env.SENTRY_PROJECT || 'plusone-guestlist',
  authToken: process.env.SENTRY_AUTH_TOKEN,   // build-time only, NOOIT NEXT_PUBLIC
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',                 // D2 — same-origin ingest
  disableLogger: true,                        // stript Sentry-debuglogs uit de client-bundle
  automaticVercelMonitors: false,             // geen cron-monitors in v1
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,        // nooit .map-files publiek serveren
    disable: !process.env.SENTRY_AUTH_TOKEN,  // CI heeft geen token → upload skipt stil
  },
});
```

Pas ook de comment onderaan aan: als `next-pwa` in fase 9 terugkomt moet dat **bínnen** de Sentry-wrap: `withSentryConfig(withPWA(nextConfig), {...})`.

### 1.3 `src/middleware.ts` — tunnel uitsluiten (KRITIEK)

Zonder deze stap 307't de auth-gate elke envelope-POST naar `/login` en komt er **nooit** een event aan — de meest waarschijnlijke stille faalmodus van dit hele plan. `monitoring` toevoegen aan de negative lookahead van de matcher (naast de bestaande uitsluitingen):

```ts
matcher: [
  '/((?!_next/static|_next/image|monitoring|favicon.ico|manifest.json|sw.js|service-worker.js|workbox-|icons/|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|woff2?)$).*)',
],
```

(Matcher-uitsluiting, niet `PUBLIC_PREFIXES` — scheelt een zinloze Supabase-sessie-refresh per envelope.)

---

## Fase 2 — SDK-configbestanden (5 nieuwe files)

### 2.1 `src/instrumentation.ts`

```ts
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('../sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('../sentry.edge.config');
}

// Captures uncaught errors in server actions, RSC renders and route handlers.
export const onRequestError = Sentry.captureRequestError;
```

### 2.2 `src/instrumentation-client.ts`

```ts
import * as Sentry from '@sentry/nextjs';
import { scrubEvent, scrubBreadcrumb } from '@/lib/observability/scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment =
  process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment,
  sendDefaultPii: false,
  sampleRate: 1.0,
  tracesSampleRate: environment === 'production' ? 0.05 : 0,
  maxBreadcrumbs: 50,
  // Door page is offline-first: queue envelopes in IndexedDB, flush on reconnect.
  transport: Sentry.makeBrowserOfflineTransport(Sentry.makeFetchTransport),
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  // NO replayIntegration — see "Replay als v2-optie" (AVG).
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

### 2.3 `sentry.server.config.ts` (repo-root)

```ts
import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from './src/lib/observability/scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment =
  process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment,
  sendDefaultPii: false,
  sampleRate: 1.0,
  tracesSampleRate: environment === 'production' ? 0.05 : 0,
  beforeSend: scrubEvent,
});
```

### 2.4 `sentry.edge.config.ts` (repo-root)

Identiek aan 2.3 (edge bundelt het apart; de scrub-module is pure en edge-safe).

### 2.5 `src/app/global-error.tsx`

Root-crashscreen. Rendert zijn eigen `<html>`/`<body>` (vervangt de root-layout) en toont **bewust géén `error.message`** — die kan PII bevatten. Inline styles, want globale CSS is er niet meer als de root-layout crasht. Donker thema conform design-tokens (`#0B0B0D`).

```tsx
'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="nl">
      <body
        style={{
          background: '#0B0B0D',
          color: '#fafafa',
          fontFamily: 'system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          margin: 0,
        }}
      >
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Er ging iets mis</h1>
          <p style={{ opacity: 0.7, marginBottom: 16 }}>
            De fout is gemeld. Probeer het opnieuw.
          </p>
          <button
            onClick={reset}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #3f3f46',
              background: '#18181b',
              color: '#fafafa',
              cursor: 'pointer',
            }}
          >
            Opnieuw proberen
          </button>
        </div>
      </body>
    </html>
  );
}
```

---

## Fase 3 — PII-scrub-laag

### 3.1 `src/lib/observability/scrub.ts`

Pure module, **alleen een type-import** van `@sentry/nextjs` (een value-import zou de SDK de vitest-node-run en de edge-bundle in trekken). Let op tsconfig `noUnusedParameters`: `_hint` underscore-prefixen of weglaten.

```ts
import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nextjs';

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Postgres unique/check violation details: `Key (email)=(x@y.nl) already exists.`
const PG_KEY_DETAIL_RE = /Key \([^)]*\)=\([^)]*\)/g;
// Phone-ish: 8+ digits with optional +, spaces, dashes, parens.
const PHONE_RE = /\+?\d[\d\s\-()]{6,}\d/g;

export function scrubText(input: string): string {
  return input
    .replace(PG_KEY_DETAIL_RE, 'Key ([redacted])=([redacted])')
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[phone]');
}

export function scrubEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  delete event.request; // cookies/headers/query/body — all of it
  if (event.user) event.user = { id: event.user.id }; // UUID only, never email/ip
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  event.breadcrumbs = event.breadcrumbs?.map((b) => ({
    ...b,
    message: b.message ? scrubText(b.message) : b.message,
  }));
  return event;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null; // app logs may contain guest objects
  if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
  return breadcrumb;
}
```

**Waarom dit de PII-vector dekt**: de gevaarlijkste lekroute is een rauwe Postgres-fout die vóórbij de `mapMutationError`-grens gooit — een 23505 draagt `Key (email)=(gast@x.nl) already exists.` De `PG_KEY_DETAIL_RE` vangt dat. De quota-meldingen (45001/45002/45005) zijn per `src/lib/db-errors.ts` bewust PII-vrije copy met alleen getallen ≤7 cijfers — die overleven de scrub leesbaar.

### 3.2 `src/lib/observability/scrub.test.ts`

Vitest-unittest (valt onder de bestaande `src/**/*.test.ts`-glob, node-env). Testcases minimaal:

1. E-mailadres in exception-value → `[email]`.
2. `+31 6 12345678` → `[phone]`.
3. `Key (email)=(jan@x.nl) already exists.` → volledig geredact.
4. Quota-melding `'Quota vol: 2 van 2 gebruikt'` blijft **onaangetast** (korte getallen overleven).
5. `event.request` wordt verwijderd; `event.user` gereduceerd tot `{ id }`.
6. Console-breadcrumb → `null` (gedropt); andere categorieën blijven.

### 3.3 `src/lib/observability/capture.ts`

De "unexpected only"-gate voor client-side captures:

```ts
import * as Sentry from '@sentry/nextjs';

/** Errors that are expected operating conditions — never report. */
function isExpected(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  // Offline fetch failures: the door/outbox handles these by design.
  if (
    typeof navigator !== 'undefined' &&
    !navigator.onLine &&
    error instanceof TypeError
  ) {
    return true;
  }
  return false;
}

export function captureUnexpectedError(
  error: unknown,
  context: { source: 'query' | 'mutation'; key?: string },
): void {
  if (isExpected(error)) return;
  Sentry.captureException(error, {
    tags: { capture_source: context.source },
    // Only the key NAMESPACE (queryKey[0]) — full keys can contain search terms.
    extra: context.key ? { key: context.key } : undefined,
  });
}
```

---

## Fase 4 — Capture-wiring & diagnostische context

> **Principe**: een event zonder context is waardeloos. Elk event moet beantwoorden: wélk scherm, wélke venue, wélke datastroom, wélke release. De scrubber haalt alléén PII-patronen weg — foutmeldingen, codes en stacks blijven volledig leesbaar (met source maps in originele TS-regels).

### 4.1 `src/features/po/PoLiveProvider.tsx`

Drie toevoegingen:

1. **QueryCache/MutationCache onError** in `createPoQueryClient()`:

```ts
import { QueryCache, MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { captureUnexpectedError } from '@/lib/observability/capture';

return new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) =>
      captureUnexpectedError(error, {
        source: 'query',
        key: String(query.queryKey[0] ?? ''),
      }),
  }),
  mutationCache: new MutationCache({
    onError: (error) => captureUnexpectedError(error, { source: 'mutation' }),
  }),
  defaultOptions: { /* ongewijzigd */ },
});
```

Dedupe-note: `retry: 1` betekent dat `onError` één keer vuurt ná de laatste retry — geen dubbele events per retry. Query-errors rethrowen hier niet naar de render, dus geen dubbel-rapportage via error boundaries.

2. **User + venue-context** in de component-body (UUID's en rollen zijn géén gast-PII):

```ts
useEffect(() => {
  Sentry.setUser({ id: identity.userId }); // UUID only — never email (AVG)
  Sentry.setTag('venue.id', identity.venueId ?? 'none');
  Sentry.setTag('roles', identity.roles.join(','));
  return () => Sentry.setUser(null);
}, [identity.userId, identity.venueId, identity.roles]);
```

3. Import `* as Sentry from '@sentry/nextjs'` + `useEffect`.

### 4.2 po-schermcontext — `src/components/po/app.tsx`

De hele po-app draait op één URL (`/app`) met een interne nav-stack — zonder dit weet je nooit op welk scherm de fout zat. In de bestaande push/tab/back-handlers (dezelfde plekken waar `navHistory`-snapshots worden gezet):

```ts
Sentry.setTag('po.screen', nextScreenId);
Sentry.addBreadcrumb({
  category: 'navigation',
  message: `${currentScreenId} → ${nextScreenId}`,
  level: 'info',
});
```

Screen-ID's zijn interne constanten (PII-vrij). Eén centrale helper aanroepen vanuit de bestaande nav-functies — niet in elke handler los kopiëren.

### 4.3 `src/features/door/DoorProvider.tsx`

Zelfde `setUser`/`setTag('venue.id', …)`-patroon als 4.1.2 in een `useEffect` (gebruik het identity/uid-veld dat de provider al heeft). **Verder niets op het deur-pad**: `replay.ts`/`drainOutbox` blijft onaangeraakt — alle geclassificeerde uitkomsten (45xxx business, offline, duplicate) zijn expected = noise. Optioneel: na een drain één `Sentry.addBreadcrumb({ category: 'outbox', message: 'drain', data: { synced, errors } })` — alleen tellers, PII-vrij.

### 4.4 Server actions — expliciet GEEN wijzigingen (D10)

De 13 `src/features/**/actions.ts` blijven exact zoals ze zijn. Geen try/catch/capture toevoegen.

---

## Fase 5 — Env-vars, `.env.example`, CI

| Var | Waar | Notes |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel (Production + Preview); tijdelijk in `.env.local` voor lokale smoke-test | `https://<key>@o<org>.ingest.de.sentry.io/<project>` — let op de **`.de.`**-host (EU, D1). Wordt client-side gebundeld; geen secret. |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Vercel (gezet door de marketplace-integratie) | Hardcoded fallback in `next.config.js`; env wint. |
| `SENTRY_AUTH_TOKEN` | **Alleen Vercel** (gezet door de integratie), build-time only | NOOIT `NEXT_PUBLIC_`, nooit committen, niet in CI (upload skipt via `sourcemaps.disable`). De secret-grep guard bewaakt alleen de service-role-key — dit token beschermen we door het uitsluitend in Vercel te laten bestaan. |

**5.1 `.env.example`** — blok toevoegen:

```
# Sentry (error monitoring, EU region — de.sentry.io)
# DSN is public (bundled client-side). Leave empty locally: SDK stays disabled.
NEXT_PUBLIC_SENTRY_DSN=
# Build-time source-map upload. Vercel-only via the Sentry marketplace
# integration. NEVER commit a real token, NEVER prefix with NEXT_PUBLIC_.
# SENTRY_ORG=
# SENTRY_PROJECT=
# SENTRY_AUTH_TOKEN=
```

**5.2 CI — nul wijzigingen.** Zonder token skipt de sourcemap-upload; zonder DSN is de SDK `enabled: false`; geen bestaande test importeert de nieuwe files; `scripts/dev-env.mjs` clobbert `.env.local` niet.

---

## Fase 6 — Testharnas (bewuste error-trigger)

### 6.1 `src/app/sentry-test/page.tsx` — server component, dicht op production

```tsx
import { notFound } from 'next/navigation';
import { SentryTestButtons } from './SentryTestButtons';

export default function SentryTestPage(): JSX.Element {
  // Local + Vercel Preview only; 404 in production.
  if (process.env.VERCEL_ENV === 'production') notFound();
  return <SentryTestButtons />;
}
```

### 6.2 `src/app/sentry-test/SentryTestButtons.tsx` (`'use client'`)

Drie knoppen: (1) client-throw `throw new Error('sentry-test: client error')`, (2) server-action-call naar 6.3 (verifieert het `onRequestError`-pad end-to-end), (3) `Sentry.captureMessage('sentry-test: message', 'info')`.

### 6.3 `src/app/sentry-test/actions.ts`

```ts
'use server';

export async function triggerServerError(): Promise<never> {
  throw new Error('sentry-test: server action error');
}
```

De middleware vereist login voor `/sentry-test` — prima: ingelogd testen verifieert meteen de `user.id`-tag. **Pagina permanent laten staan** (404't op prod).

---

## Fase 7 — Handmatige stappen (Max)

1. **Sentry-account/org**: aanmelden op sentry.io → bij het aanmaken van de organisatie **data storage location: European Union** kiezen (org komt op `de.sentry.io`). **Gratis Developer-plan** (5k errors/mnd, 1 seat, e-mail alerts) — bewuste keuze 2026-07-06; Team-plan ($26/mnd, Slack + 90 dagen retentie) is een latere upgrade.
2. **Project aanmaken**: platform = **Next.js**, naam `plusone-guestlist`. DSN kopiëren en checken dat de host `.ingest.de.sentry.io` bevat. De install-wizard **overslaan** — de code komt uit dit plan. Noteer de **org-slug** (nodig voor de `REPLACE_ME_ORG_SLUG`-fallback in `next.config.js`, fase 1.2).
3. **Vercel marketplace-integratie**: Vercel-dashboard → Integrations → "Sentry" → installeren → Vercel-project ⇄ Sentry-project koppelen. Dit zet `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` automatisch en koppelt deploys aan releases.
4. **DSN-env**: Vercel → project → Settings → Environment Variables → checken of de integratie `NEXT_PUBLIC_SENTRY_DSN` heeft gezet; zo niet, handmatig toevoegen voor Production + Preview. Check meteen dat **"Automatically expose System Environment Variables"** aan staat (nodig voor `NEXT_PUBLIC_VERCEL_ENV`, D8).
5. **Alert rules** (Sentry → Alerts → Create Alert → Issues), alle drie met filter `environment: production`, actie = **e-mail naar Max**:
   - *New issue*: "A new issue is created" (action interval 5 min).
   - *Regression*: "The issue changes state from resolved to unresolved".
   - *Spike*: "The issue is seen more than **25** times in **1 hour**" (later tunen).
6. **AVG-hygiëne (aanbevolen)**: Sentry → Settings → Security & Privacy → server-side data scrubbing aan + **"Prevent Storing of IP Addresses"** aan (defence-in-depth achter onze `beforeSend`).

---

## Fase 8 — Verificatie (implementator)

1. `pnpm lint` + `pnpm type-check` + `pnpm vitest run` groen (let op: `pnpm test` = watch-mode). `scrub.test.ts` draait mee; niets anders raakt bestaande tests.
2. `pnpm build` **zonder** `SENTRY_AUTH_TOKEN` → slaagt, upload geskipt (CI-pariteit).
3. **Lokale smoke**: echte DSN tijdelijk in `.env.local`, `pnpm build && pnpm start`, inloggen, `/sentry-test` → alle drie de triggers vuren. Network-tab: envelope-POSTs gaan naar **`/monitoring?o=…`** (same-origin, géén CSP-violation in de console). DSN daarna weer uit `.env.local`.
4. **Preview-deploy**: branch pushen → herhalen op de Vercel-preview-URL.
5. **In de Sentry-UI per event checken**: leesbare TS-stacktrace (source maps OK); `release` = git-SHA; `environment` klopt; **Request-sectie afwezig** (geen cookies/headers/query); user = alleen UUID; `venue.id`/`roles`/`po.screen`-tags aanwezig; geen console-breadcrumbs; navigatie-breadcrumbs tonen de po-schermflow. Eén keer bewust een duplicate-guest-fout triggeren en checken dat `Key (…)=(…)` als `[redacted]` verschijnt.
6. **Offline-test**: op `/door` device offline zetten, client-error veroorzaken, online → event komt alsnog binnen (offline transport).
7. **Alert-test**: nieuwe issue → e-mail bij Max binnen. Daarna ClickUp-checklist op [86ey3x3af](https://app.clickup.com/t/86ey3x3af) aftikken.

---

## Risico's & gotchas

- **Middleware eet de tunnel** — dé stille faalmodus. Zonder fase 1.3 worden envelopes naar `/login` ge-307't en komt er nooit iets aan. Verifieer expliciet via stap 8.3.
- **PG-`Key (…)`-details zijn de #1 PII-vector**, niet de quota-meldingen. De scrubber dekt het, maar voeg NOOIT `includeLocalVariables` of `attachScreenshot` toe — die lekken gastdata buiten de scrub om.
- **`import type` in `scrub.ts` moet type-only blijven** — een value-import trekt de SDK de vitest-run en de edge-bundle in.
- **tsconfig `noUnusedParameters`**: `_hint` underscore-prefixen.
- **`deleteSourcemapsAfterUpload` + geen token** = een handmatig gedeployde build zonder token heeft nergens maps → minified traces. Acceptabel: deploys lopen alleen via Vercel (mét token).
- **Buildtijd**: de Sentry-webpack-plugin kost ~30–60s extra per Vercel-build (upload + widenClientFileUpload). Verwacht, geen hang.
- **Toekomstig PWA-herstel (fase 9)**: `withPWA` bínnen `withSentryConfig`; de handmatige `public/service-worker.js` cachet alleen GET's, dus `/monitoring`-POSTs blijven veilig — bij een SW-rewrite dit zo houden.
- **Capacitor later**: de tunnel werkt zolang de webview de remote URL laadt. Als we ooit gebundelde assets shippen: heroverwegen (directe DSN + native allowlist + CSP-entry).
- **Next-versie**: `instrumentation-client.ts` vereist Next ≥15.3. Bij een (onwaarschijnlijke) downgrade stopt de client-SDK stil met initialiseren.
- **`pnpm test` is watch-mode** — in CI/verificatie altijd `pnpm vitest run`.

## Replay als v2-optie (bewust uitgesteld)

Session replay staat in v1 **uit** — niet omdat het juridisch onmogelijk is, maar omdat replay de DOM opneemt en gastdata van de venues is (wij zijn verwerker; gasten hebben ons privacybeleid nooit gezien). Het mag later wél, onder drie voorwaarden, allemaal tegelijk:

1. **Masking maximaal**: `replayIntegration({ maskAllText: true, blockAllMedia: true })` (Sentry's defaults) — álle tekst wordt gemaskeerd weergegeven, dus ook gastnamen. Nooit unmasken per element op schermen die gastdata tonen.
2. **Papierwerk**: passage in het privacybeleid + de verwerkersafspraken met venues (subverwerker Sentry, EU-datalocatie), en de Sentry-DPA getekend (standaard beschikbaar; EU-region maakt dit eenvoudig).
3. **Kosten**: replay telt apart in het Sentry-quotum — start dan met `replaysOnErrorSampleRate: 0.1`, `replaysSessionSampleRate: 0`.

Tot die tijd geven de po-scherm-breadcrumbs (fase 4.2) het meeste van wat replay zou opleveren, zonder AVG-risico.
