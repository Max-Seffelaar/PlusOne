// Landing-slug helpers — pure, mirrored from public.events_set_landing_slug in
// 20260613200000_event_management.sql (updated by 20260625100000_event_slug_date_suffix.sql).
// Slug format: name-yyyy-mm-dd (e.g. summer-rave-2026-07-12).

/** Lowercase, non-alphanumerics → single '-', trimmed. Matches SQL slugify(). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build a landing slug from an event name and its start date.
 * Format: slugified-name-yyyy-mm-dd (UTC date). Falls back to "event" when the
 * name has no usable characters. Generated once at creation; never editable
 * afterwards — a shared link must not break.
 */
export function buildEventSlug(name: string, startsAt: Date | string): string {
  const base = slugify(name) || 'event';
  const d = new Date(startsAt);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${base}-${yyyy}-${mm}-${dd}`;
}
