// Landing-slug helpers — pure, mirrored from public.slugify in
// 20260613200000_event_management.sql. The app builds a nice slug from the event
// name and date; the database BEFORE-INSERT trigger is the backstop (fills a slug
// when blank) and the unique index is the authority on collisions.

/** Lowercase, non-alphanumerics → single '-', trimmed. Matches SQL slugify(). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build a landing slug from an event name and its start date.
 * Format: name-yyyy-mm-dd (e.g. "summer-rave-2026-07-12").
 * Falls back to "event" when the name has no usable characters.
 * The slug is generated once at creation and never editable — shared links must not break.
 *
 * @param date ISO date string (YYYY-MM-DD) from starts_at
 */
export function buildEventSlug(name: string, date: string): string {
  const base = slugify(name) || 'event';
  return `${base}-${date}`;
}
