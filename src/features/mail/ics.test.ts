import { describe, expect, it } from 'vitest';
import { buildIcs, escapeIcsText, foldIcsLine, googleCalendarUrl, type CalendarEvent } from './ics';

const event: CalendarEvent = {
  id: 'ee000000-0000-7000-8000-000000000001',
  name: 'Neon Friday',
  startsAt: '2026-10-17T21:00:00Z',
  endsAt: '2026-10-18T03:00:00Z',
  location: 'Club Vesper, Keizersgracht 1',
  updatedAt: '2026-10-09T10:00:00Z',
};

describe('buildIcs', () => {
  it('is a single VEVENT with a stable UID per event', () => {
    const ics = buildIcs(event, new Date('2026-10-09T12:00:00Z'));
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('UID:ee000000-0000-7000-8000-000000000001@plus-one.io');
    expect(ics).toContain('DTSTART:20261017T210000Z');
    expect(ics).toContain('DTEND:20261018T030000Z');
    expect(ics).toContain('LOCATION:Club Vesper\\, Keizersgracht 1');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('a later update of the event gets a higher SEQUENCE (updates the old entry)', () => {
    const seq = (e: CalendarEvent) => Number(/SEQUENCE:(\d+)/.exec(buildIcs(e))?.[1]);
    expect(seq({ ...event, updatedAt: '2026-10-10T10:00:00Z' })).toBeGreaterThan(seq(event));
  });

  it('defaults the end to six hours without an end time', () => {
    expect(buildIcs({ ...event, endsAt: null })).toContain('DTEND:20261018T030000Z');
  });

  it('cannot inject a property through the name', () => {
    const ics = buildIcs({ ...event, name: 'Party\r\nATTENDEE:mailto:x@y.z' });
    expect(ics).not.toMatch(/\r\nATTENDEE/);
    expect(escapeIcsText('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
  });

  it('folds long lines at 75 octets', () => {
    const folded = foldIcsLine(`SUMMARY:${'é'.repeat(100)}`);
    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').slice(1).every((l) => l.startsWith(' '))).toBe(true);
  });
});

describe('googleCalendarUrl', () => {
  it('prefills the event without adding anything automatically', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin).toBe('https://calendar.google.com');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Neon Friday');
    expect(url.searchParams.get('dates')).toBe('20261017T210000Z/20261018T030000Z');
    expect(url.searchParams.get('location')).toBe('Club Vesper, Keizersgracht 1');
  });
});
