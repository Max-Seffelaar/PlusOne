/**
 * Defence in depth for URL-shaped properties posthog-js adds on its own
 * (`$current_url`, `$referrer`, …). PlusOne URLs carry no PII by rule (CLAUDE.md
 * security checklist), but a query string or hash is where a token, a search
 * term or a future mistake would sit (`/s/<token>`, `?q=<name>`). So every one
 * of them leaves the device as origin + path only.
 */

const URL_KEYS = [
  '$current_url',
  '$referrer',
  '$initial_referrer',
  '$initial_current_url',
  '$prev_pageview_pathname',
  '$pathname',
  '$referring_domain',
  '$initial_referring_domain',
] as const;

/** `https://x.test/a/b?c=d#e` → `https://x.test/a/b`. Non-URLs lose anything after `?`/`#`. */
export function stripQueryAndHash(value: string): string {
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? '';
  }
}

/** Return a copy of `props` with every known URL property stripped of query and hash. */
export function stripUrlProperties<T extends Record<string, unknown> | undefined>(props: T): T {
  if (!props) return props;
  const out: Record<string, unknown> = { ...props };
  for (const k of URL_KEYS) {
    const v = out[k];
    if (typeof v === 'string') out[k] = stripQueryAndHash(v);
  }
  return out as T;
}
