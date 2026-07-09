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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
