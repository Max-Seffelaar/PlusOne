import type { Breadcrumb, ErrorEvent, Event, EventHint } from '@sentry/nextjs';

// PII lives in more than one place on a Sentry event, and the pattern scrubbers
// below can't recognise a bare guest name (no @, no digits, no `Key(...)=`). The
// biggest silent vector is a PostgREST filter in a URL: a name search runs over
// the BROWSER client as `?full_name=ilike.%Jan%`, which the SDK records as a
// fetch breadcrumb `data.url` and (when sampled) an http.client span. So we:
//   1. delete `event.request` outright (cookies/headers/query/body),
//   2. reduce `event.user` to the UUID,
//   3. strip query strings from any URL, everywhere (messages, exception values,
//      breadcrumb messages + `data`, and span descriptions + `data`),
//   4. redact email / phone / `Key(col)=(value)` patterns in every free-text field.
// `event.extra` / `event.contexts` are only shallow-scrubbed as a backstop — do
// NOT rely on it; capture sites must never put raw guest objects there.
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Postgres unique/check violation details: `Key (email)=(x@y.nl) already exists.`
const PG_KEY_DETAIL_RE = /Key \([^)]*\)=\([^)]*\)/g;
// Phone-ish: 8+ digits with optional +, spaces, dashes, parens.
const PHONE_RE = /\+?\d[\d\s\-()]{6,}\d/g;
// Query string on any http(s) URL — PostgREST filters (?full_name=ilike.%Jan%,
// ?email=eq.…) carry guest data a name-blind pattern scrubber can't catch.
const URL_QUERY_RE = /(https?:\/\/[^\s"'?]+)\?[^\s"']*/g;

export function scrubText(input: string): string {
  return input
    .replace(URL_QUERY_RE, '$1?[filtered]')
    .replace(PG_KEY_DETAIL_RE, 'Key ([redacted])=([redacted])')
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[phone]');
}

/** Shallow-scrub the string values of a data bag (breadcrumb.data / span.data).
 *  Shallow is enough: fetch/http data bags are flat (`url`, `method`, …). */
function scrubData<T extends Record<string, unknown> | undefined>(data: T): T {
  if (!data) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = typeof value === 'string' ? scrubText(value) : value;
  }
  return out as T;
}

export function scrubEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  delete event.request; // cookies/headers/query/body — all of it
  if (event.user) event.user = { id: event.user.id }; // UUID only, never email/ip
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  // Reuse scrubBreadcrumb so message + data + console-drop stay in one place.
  event.breadcrumbs = event.breadcrumbs
    ?.map((b) => scrubBreadcrumb(b))
    .filter((b): b is Breadcrumb => b !== null);
  if (event.extra) event.extra = scrubData(event.extra); // backstop only
  return event;
}

/** beforeSendTransaction: performance events never run through `beforeSend`, so
 *  their span URLs (the same PostgREST filters) would ship unscrubbed. Generic
 *  over Event so it satisfies the `beforeSendTransaction` signature without
 *  importing TransactionEvent (not re-exported by @sentry/nextjs). */
export function scrubTransaction<T extends Event>(event: T, _hint: EventHint): T {
  delete event.request;
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubText(span.description);
    if (span.data) span.data = scrubData(span.data);
  }
  return event;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null; // app logs may contain guest objects
  if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
  if (breadcrumb.data) breadcrumb.data = scrubData(breadcrumb.data as Record<string, unknown>);
  return breadcrumb;
}
