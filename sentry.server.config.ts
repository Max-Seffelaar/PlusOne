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
