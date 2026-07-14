/**
 * Browser Sentry init — split OUT of the First Load JS (#B2, task 86ey9e8z5).
 *
 * This module is NEVER statically imported by app code. It is loaded lazily
 * (via `src/lib/observability/sentry-client.ts`) once the page is idle or the
 * first telemetry call fires, so the ~131 kB gz browser SDK never lands in any
 * route's First Load bundle — not the offline door route, not the public guest
 * links. Importing this module runs `Sentry.init` as a side effect and hands the
 * initialised namespace back through the `Sentry` export.
 *
 * The name is deliberately NOT `sentry.client.config.ts` (a magic filename the
 * Sentry Next.js wizard/plugin auto-registers as an eager entry) — that would
 * re-eagerize the SDK and defeat the whole split.
 */
import * as Sentry from '@sentry/nextjs';
import { scrubEvent, scrubBreadcrumb, scrubTransaction } from '@/lib/observability/scrub';

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
  beforeSendTransaction: scrubTransaction,
  beforeBreadcrumb: scrubBreadcrumb,
  // NO replayIntegration — see "Replay als v2-optie" (AVG).
});

export { Sentry };
