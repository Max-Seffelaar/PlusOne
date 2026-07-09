import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nextjs';

// PII patterns. These are the only guest-data shapes that can slip past the
// MutationError boundary into an error payload — a raw Postgres error, an
// exception value, or a breadcrumb built from a guest object.
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
