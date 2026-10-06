// Edge runtime bundles separately from the Node server config; the scrub module
// is pure and edge-safe (type-only Sentry import), so it re-uses beforeSend here.
import * as Sentry from '@sentry/nextjs';
import { scrubEvent, scrubBreadcrumb, scrubTransaction } from './src/lib/observability/scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment =
  process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment,
  sendDefaultPii: false,
  sampleRate: 1.0,
  // Temporary, until 2026-10-14: trace EVERY /app request so the layout's
  // Supabase/GoTrue call chain is visible as spans in Sentry → Performance
  // (docs/perf-audit-2026-10.md, finding 2 — a hypothesis from the code that
  // the traces must confirm before P1 changes anything). Everything else stays
  // at the old 5%. Revert to a flat `tracesSampleRate: 0.05` afterwards.
  tracesSampler: ({ name, inheritOrSampleWith }) => {
    if (environment !== 'production') return 0;
    if (name.includes('/app')) return 1.0;
    return inheritOrSampleWith(0.05);
  },
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubTransaction,
  beforeBreadcrumb: scrubBreadcrumb, // drop console breadcrumbs on the edge too
});
