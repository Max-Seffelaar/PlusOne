// @vitest-environment jsdom
//
// Regression coverage for 86eya4yuf: usePoDoorEvent must read the venue's FULL
// event history. The 7-day window it briefly shared with Home's poll
// (86ey9e8gt) cut off pickDoorEvent's "most recent already-started event"
// fallback — a venue whose latest event is >7 days old (nothing upcoming)
// resolved to null and the Deur surface had no event to work.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PoEventRow } from './queries';

const fetchEventsMock = vi.fn<unknown[], Promise<PoEventRow[]>>(async () => []);

vi.mock('./queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./queries')>();
  return {
    ...actual,
    fetchEvents: (...args: unknown[]) => fetchEventsMock(...args),
  };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1', userId: 'user-1', venueName: 'Venue', roles: ['doorhost'] }),
}));

import { usePoDoorEvent } from './hooks';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return wrapper;
}

function row(id: string, startsAt: string): PoEventRow {
  return {
    id,
    name: `Event ${id}`,
    starts_at: startsAt,
    ends_at: null,
    status: 'open',
    cancelled_at: null,
    list_locked: false,
    venue_name: 'Venue',
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePoDoorEvent (86eya4yuf — unwindowed door pick)', () => {
  it('fetches the venue events WITHOUT a starts_at lower bound', async () => {
    const { result } = renderHook(() => usePoDoorEvent(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchEventsMock).toHaveBeenCalledTimes(1);
    // (client, venueId) and nothing else — a third `sinceIso` arg would
    // reintroduce the window that nulled the pick for >7-day-old venues.
    expect(fetchEventsMock.mock.calls[0].length).toBe(2);
    expect(fetchEventsMock.mock.calls[0][1]).toBe('venue-1');
  });

  it('resolves the most recent already-started event when the venue has only old events', async () => {
    // Both events are far in the past relative to the real clock — exactly the
    // venue shape the 7-day window used to blank out.
    fetchEventsMock.mockResolvedValueOnce([
      row('ancient', '2026-01-10T20:00:00Z'),
      row('lessAncient', '2026-03-10T20:00:00Z'),
    ]);
    const { result } = renderHook(() => usePoDoorEvent(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('lessAncient');
  });
});
