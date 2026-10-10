// Calendar for a guest's spot (Gastcommunicatie F, z8uq9m2vpy): an .ics
// (served by /s/[token]/calendar.ics, linked from the mail as "Apple or
// Outlook (.ics)") and a Google Calendar template link. Pure; no I/O.
//
// The UID is the event's own id, so a later .ics for the same event (after
// "New details for …") updates the entry the guest already added instead of
// adding a second one; SEQUENCE grows with the event's updated_at. Text is
// escaped per RFC 5545 §3.3.11 and lines are folded at 75 octets (§3.1).
// Control characters (CR/LF included) never reach a property value, so an
// event name cannot inject a property.

export interface CalendarEvent {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  updatedAt: string | null;
}

/** An event without an end time lasts this long in a calendar. */
const DEFAULT_DURATION_MS = 6 * 60 * 60 * 1000;

function endOf(event: CalendarEvent): Date {
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;
  return end && end.getTime() > start.getTime() ? end : new Date(start.getTime() + DEFAULT_DURATION_MS);
}

/** 20261018T210000Z */
function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function oneLine(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeIcsText(value: string): string {
  return oneLine(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

/** Fold one content line into 75-octet chunks (continuation lines start with a space). */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function buildIcs(event: CalendarEvent, now: Date = new Date()): string {
  const start = new Date(event.startsAt);
  const updated = event.updatedAt ? new Date(event.updatedAt) : null;
  const sequence = updated && !Number.isNaN(updated.getTime()) ? Math.max(0, Math.floor(updated.getTime() / 1000) - 1_700_000_000) : 0;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PlusOne//Guest list//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${oneLine(event.id).replace(/[^0-9a-zA-Z-]/g, '')}@plus-one.io`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(endOf(event))}`,
    `SUMMARY:${escapeIcsText(event.name)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/** Google Calendar's "add event" template link. Opens a prefilled form; nothing is added automatically. */
export function googleCalendarUrl(event: CalendarEvent): string {
  const start = new Date(event.startsAt);
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: oneLine(event.name),
    dates: `${utcStamp(start)}/${utcStamp(endOf(event))}`,
  });
  if (event.location) q.set('location', oneLine(event.location));
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
