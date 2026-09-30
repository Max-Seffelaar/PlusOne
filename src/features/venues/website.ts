// The venue website rule (z8uq9m0hw2), shared by the Zod schema (server-side
// truth) and the settings field (so the UI shows what will be saved).

/** Any `scheme:` prefix ('https:', 'javascript:', 'mailto:', 'ftp:' …). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Trims, and gives a scheme-less host ('nu.nl', 'www.club.nl/agenda') an
 *  `https://` prefix. Blank stays ''. Input that already carries ANY scheme is
 *  returned untouched, so 'javascript:…' / 'ftp://…' still fail isHttpUrl. */
export function normalizeWebsite(raw: string): string {
  const v = raw.trim();
  if (v === '' || HAS_SCHEME.test(v) || !/^[a-z0-9]/i.test(v)) return v;
  return `https://${v}`;
}

/** An absolute http(s) URL with a dotted host and no whitespace
 *  ('https://clubnova.nl'). Mirrors the DB CHECK venues_website_http_check,
 *  which only pins the scheme + length. */
export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}
