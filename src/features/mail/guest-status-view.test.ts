import { describe, expect, it } from 'vitest';
import { CALENDAR_DESCRIPTION_MAX, calendarDescription, toGuestStatusView } from './guest-status-view';
import { buildIcs, googleCalendarUrl } from './ics';

function payload(over: Record<string, unknown> = {}) {
  return {
    found: true,
    state: 'on_list',
    first_name: 'Lotte',
    plus_ones: 1,
    tier_name: 'Guest',
    price_cents: 1500,
    event: {
      id: 'ee000000-0000-7000-8000-000000000001',
      name: 'Neon Friday',
      starts_at: '2026-10-17T21:00:00Z',
      ends_at: '2026-10-18T03:00:00Z',
      location_name: 'Club Vesper',
      location_address: 'Keizersgracht 1',
      house_rules: 'No sneakers.',
      updated_at: '2026-10-09T10:00:00Z',
    },
    company: {
      name: 'Vesper Group',
      contact_email: 'hi@vesper.test',
      website: 'https://vesper.test',
      channels: { instagram: '@vesper', phone: '+31 20 123', unknown: 'x', tiktok: '' },
    },
    ...over,
  };
}

describe('toGuestStatusView', () => {
  it('renders the spot like the mail does', () => {
    const v = toGuestStatusView(payload());
    expect(v?.spotLine).toBe('Guest · You +1 (2 people)');
    expect(v?.priceLine).toBe('Entry per person: €15, pay at the door');
    expect(v?.location).toBe('Club Vesper, Keizersgracht 1');
    expect(v?.houseRules).toBe('No sneakers.');
    expect(v?.channels).toEqual([
      { key: 'phone', value: '+31 20 123' },
      { key: 'instagram', value: '@vesper' },
    ]);
  });

  it('+0 is "1 person" with "Entry:"', () => {
    const v = toGuestStatusView(payload({ plus_ones: 0 }));
    expect(v?.spotLine).toBe('Guest · 1 person');
    expect(v?.priceLine).toBe('Entry: €15, pay at the door');
  });

  it('shows no spot, price or house rules once the spot no longer holds', () => {
    for (const state of ['off_list', 'canceled']) {
      const v = toGuestStatusView(payload({ state }));
      expect(v?.spotLine, state).toBeNull();
      expect(v?.priceLine, state).toBeNull();
      expect(v?.houseRules, state).toBeNull();
    }
  });

  it('only an http(s) website becomes a link', () => {
    expect(toGuestStatusView(payload({ company: { ...payload().company, website: 'javascript:alert(1)' } }))?.website).toBeNull();
  });

  it('anything that is not a found payload is the neutral not-found', () => {
    expect(toGuestStatusView({ found: false })).toBeNull();
    expect(toGuestStatusView(null)).toBeNull();
    expect(toGuestStatusView(payload({ state: 'weird' }))).toBeNull();
    expect(toGuestStatusView(payload({ event: { ...payload().event, starts_at: 'nope' } }))).toBeNull();
  });

  it('carries the info for guests into the page and the calendar while the spot holds (z8uq9m4a5n)', () => {
    const ev = { ...payload().event, guest_info: 'Park at P2.\r\nEntrance on the side street.\u0007' };
    const v = toGuestStatusView(payload({ event: ev }));
    expect(v?.guestInfo).toBe('Park at P2.\nEntrance on the side street.');
    // The fixture has house rules too: they follow the info under their label.
    expect(v?.calendar.description).toBe('Park at P2.\nEntrance on the side street.\n\nHouse rules:\nNo sneakers.');
    for (const state of ['off_list', 'canceled']) {
      const off = toGuestStatusView(payload({ state, event: ev }));
      expect(off?.guestInfo, state).toBeNull();
      expect(off?.calendar.description, state).toBeNull();
    }
    // A payload from before the migration (no key) still parses.
    expect(toGuestStatusView(payload())?.guestInfo).toBeNull();
  });
});

describe('calendarDescription (house rules in the calendar, z8uq9m4a5n follow-up)', () => {
  it('info first, then the house rules under their label; either alone; none = null', () => {
    expect(calendarDescription('Park at P2.', '21+, bring ID')).toBe('Park at P2.\n\nHouse rules:\n21+, bring ID');
    expect(calendarDescription(null, '21+')).toBe('House rules:\n21+');
    expect(calendarDescription('Park at P2.', null)).toBe('Park at P2.');
    expect(calendarDescription('  \n ', '\t')).toBeNull();
  });

  it('strips controls and bidi overrides from the house rules too, line breaks kept', () => {
    expect(calendarDescription(null, 'No\u0007 sneakers\r\nBring\u202E ID')).toBe('House rules:\nNo sneakers\nBring ID');
  });

  it('caps the combined text so the Google URL stays bounded', () => {
    const d = calendarDescription('a'.repeat(1000), 'b'.repeat(500)) ?? '';
    expect(d.length).toBeLessThanOrEqual(CALENDAR_DESCRIPTION_MAX);
    expect(d).toContain('House rules:');
    expect(calendarDescription('a'.repeat(5000), 'b'.repeat(5000))!.length).toBeLessThanOrEqual(CALENDAR_DESCRIPTION_MAX);
  });

  it('reaches the .ics DESCRIPTION and Google details through the status view, escaped', () => {
    const ev = { ...payload().event, guest_info: 'Park at P2; side door', house_rules: 'No <script>, bring ID' };
    const v = toGuestStatusView(payload({ event: ev }))!;
    const ics = buildIcs(v.calendar).replace(/\r\n /g, '');
    expect(ics).toContain('DESCRIPTION:Park at P2\\; side door\\n\\nHouse rules:\\nNo <script>\\, bring ID\r\n');
    expect(new URL(googleCalendarUrl(v.calendar)).searchParams.get('details')).toBe(
      'Park at P2; side door\n\nHouse rules:\nNo <script>, bring ID',
    );
  });
});
