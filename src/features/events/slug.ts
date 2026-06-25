// Landing-slug helpers — pure, mirrored from public.slugify in
// 20260613200000_event_management.sql. The app builds a nice slug from the event
// name; the database BEFORE-INSERT trigger is the backstop (fills a slug when
// blank) and the unique index is the authority on collisions.

/** Lowercase, non-alphanumerics → single '-', trimmed. Matches SQL slugify(). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A short random suffix that keeps slugs unique without leaking anything. */
export function randomSlugSuffix(length = 4): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
  }
  return out;
}

/**
 * Build a landing slug: {name}-{YYYY-MM-DD}-{random}.
 *
 * The date (from the event's starts_at) makes the slug human-readable and
 * means two events with the same name on different dates never collide.
 * The random suffix defeats slug enumeration — without it a bot could probe
 * predictable names to discover valid landing links.
 *
 * startsAt must be an ISO datetime string (e.g. "2026-07-15T22:00:00").
 * suffix is injectable so unit tests are deterministic.
 * The slug is generated once at creation and never editable afterwards.
 */
export function buildEventSlug(
  name: string,
  startsAt: string,
  suffix: string = randomSlugSuffix(),
): string {
  const base = slugify(name) || 'event';
  const date = startsAt.slice(0, 10); // YYYY-MM-DD
  return `${base}-${date}-${suffix}`;
}
