// @vitest-environment jsdom
//
// Snelheid P2 review (#490, BLOCKING): the All-guests tab must not depend on the
// windowed event list. A quiet season (no event in the window) still lists the
// venue's guests, and a guest of an older event keeps its event name — the name
// comes from the guest row's own embed. Plus the window's staleTime rule.
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const H = vi.hoisted(() => ({ calls: 0 }));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u1', venueId: 'v1', venueName: null, roles: ['admin'] }),
}));
vi.mock('./queries', async (orig) => {
  const actual = await orig<typeof import('./queries')>();
  return {
    ...actual,
    fetchVenueGuestsWindow: vi.fn(async () => {
      H.calls += 1;
      return {
        rows: [{
          id: 'g1', full_name: 'Old Guest', plus_ones: 0, status: 'approved', tier_id: 't1', note: null, note_priority: 'none',
          note_acknowledged_at: null, created_at: '2025-01-01T20:00:00Z', contact_id: null, anonymized_at: null, event_id: 'e-old',
          source: 'app', addedByName: null, addedByKind: 'system', linkLabel: null,
          tierName: 'Regular', tierColor: null, eventName: 'Old Night',
        }],
        total: 1,
      };
    }),
  };
});

const { useVenueGuests, windowStaleTime } = await import('./hooks');

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useVenueGuests without the events window', () => {
  it('loads with no events at all, and names an older guest\'s event from the row', async () => {
    H.calls = 0;
    const { result } = renderHook(() => useVenueGuests(true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.guests[0]).toMatchObject({ name: 'Old Guest', eventId: 'e-old', eventName: 'Old Night' });
  });

  it('stays off in single-event mode', () => {
    H.calls = 0;
    renderHook(() => useVenueGuests(false), { wrapper });
    expect(H.calls).toBe(0);
  });
});

describe('windowStaleTime', () => {
  const q = (rows: { starts_at: string; ends_at: string | null }[]) => ({ state: { data: { rows } } }) as unknown as Query<never>;
  const h = 3600_000;
  it('is 30 s while an event in the window is live, 5 min otherwise', () => {
    const now = Date.now();
    expect(windowStaleTime(q([{ starts_at: new Date(now - h).toISOString(), ends_at: new Date(now + h).toISOString() }]) as never)).toBe(30_000);
    expect(windowStaleTime(q([{ starts_at: new Date(now + 24 * h).toISOString(), ends_at: new Date(now + 30 * h).toISOString() }]) as never)).toBe(300_000);
    expect(windowStaleTime(q([]) as never)).toBe(300_000);
  });
});
