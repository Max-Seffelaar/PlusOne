// Event date/time formatting, pinned to Europe/Amsterdam so display is correct
// regardless of the server timezone (Vercel runs UTC). Events hang on the event,
// not the calendar day (#26): a 23:00→05:00 range is rendered as one evening.

const TZ = 'Europe/Amsterdam';

const dateFmt = new Intl.DateTimeFormat('nl-NL', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat('nl-NL', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
});

export function formatEventDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function formatEventTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** e.g. "za 20 jun 2026 · 23:00–05:00" (or just the start when there's no end). */
export function formatEventRange(startsAt: string, endsAt: string | null): string {
  const date = formatEventDate(startsAt);
  const start = formatEventTime(startsAt);
  if (!endsAt) return `${date} · ${start}`;
  return `${date} · ${start}–${formatEventTime(endsAt)}`;
}
