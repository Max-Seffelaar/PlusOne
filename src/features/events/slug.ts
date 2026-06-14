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
 * Build a landing slug from an event name plus a random suffix for uniqueness.
 * Falls back to "event" when the name has no usable characters. The suffix is
 * injectable so the unit test is deterministic.
 */
export function buildEventSlug(name: string, suffix: string = randomSlugSuffix()): string {
  const base = slugify(name) || 'event';
  return `${base}-${suffix}`;
}

/** Validates a user-provided custom slug (edit form). */
export function isValidCustomSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 3 && slug.length <= 80;
}
