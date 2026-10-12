// The live Google Calendar link (z8uq9m4a5n): token-gated exactly like
// calendar.ics, a 302 built from the CURRENT event, nothing leaks via the
// Referer or a cache.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestStatusView } from '@/features/mail/guest-status-view';

const load = vi.fn<[string], Promise<GuestStatusView | null>>();
vi.mock('@/features/mail/guest-status-fetch', () => ({ loadGuestStatus: (t: string) => load(t) }));

const { GET } = await import('./route');
const ics = await import('../calendar.ics/route');

const TOKEN = 'A'.repeat(43);

function view(over: Partial<GuestStatusView> = {}): GuestStatusView {
  return {
    state: 'on_list',
    firstName: 'Lotte',
    eventName: 'Neon Friday',
    date: 'Sat 17 Oct',
    time: '23:00',
    location: 'Club Vesper, Keizersgracht 1',
    spotLine: null,
    priceLine: null,
    houseRules: null,
    guestInfo: 'Park at P2.\nSide entrance.',
    company: 'Vesper Group',
    contactEmail: null,
    website: null,
    channels: [],
    calendar: {
      id: 'ee000000-0000-7000-8000-000000000001',
      name: 'Neon Friday',
      startsAt: '2026-10-17T21:00:00Z',
      endsAt: null,
      location: 'Club Vesper, Keizersgracht 1',
      updatedAt: null,
      description: 'Park at P2.\nSide entrance.',
    },
    ...over,
  };
}

const call = (handler: typeof GET, token = TOKEN) =>
  handler(new Request(`https://app.plus-one.io/s/${token}/google`), { params: Promise.resolve({ token }) });

describe('/s/[token]/google', () => {
  beforeEach(() => {
    load.mockReset();
  });

  it('redirects to Google with the current location and details', async () => {
    load.mockResolvedValue(view());
    const res = await call(GET);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get('Location') ?? '');
    expect(url.origin).toBe('https://calendar.google.com');
    expect(url.searchParams.get('location')).toBe('Club Vesper, Keizersgracht 1');
    expect(url.searchParams.get('details')).toBe('Park at P2.\nSide entrance.');
    expect(url.toString()).not.toContain(TOKEN);
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(load).toHaveBeenCalledWith(TOKEN);
  });

  it('checked in still gets the link', async () => {
    load.mockResolvedValue(view({ state: 'checked_in' }));
    expect((await call(GET)).status).toBe(302);
  });

  it('unknown/expired/throttled, off the list and canceled all get the same bare 404 as calendar.ics', async () => {
    const cases: Array<GuestStatusView | null> = [null, view({ state: 'off_list' }), view({ state: 'canceled' })];
    for (const c of cases) {
      load.mockResolvedValue(c);
      const res = await call(GET);
      load.mockResolvedValue(c);
      const icsRes = await call(ics.GET);
      expect(res.status).toBe(404);
      expect(res.headers.get('Location')).toBeNull();
      expect(await res.text()).toBe(await icsRes.text());
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});
