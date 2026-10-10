import { describe, expect, it } from 'vitest';
import { toGuestStatusView } from './guest-status-view';

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
});
