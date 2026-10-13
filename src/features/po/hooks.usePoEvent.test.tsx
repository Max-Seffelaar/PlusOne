// @vitest-environment jsdom
/**
 * Regression cover for `usePoEvent`'s `notFound` gating (86ey9e9vc review
 * round 2, finding 5). `usePoEvents()`'s `.data` is never `undefined` now
 * (Step 5b's stable-empty-array fallback), so a `!isLoading` guard can no
 * longer tell "the query never ran" apart from "the query ran and this id
 * isn't in the result" — the same trap as Blocker 2's T6 auto-open effect.
 * A disabled query (`enabled: !!venueId` with no venueId yet) has
 * `isLoading: false` too, exactly like a settled one.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { poKeys } from './keys';
import type { ReactNode } from 'react';

const H = vi.hoisted(() => ({
  venueId: null as string | null,
  fetches: 0,
  headScopes: [] as unknown[],
  order: [] as string[],
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u1', venueId: H.venueId, venueName: null, roles: [] }),
}));
vi.mock('./queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./queries')>();
  return {
    ...actual,
    // The single-event read (Snelheid P1) filters by id server-side: honour it.
    fetchEvents: async (_c: unknown, _v: string, scope?: { eventId?: string }) => {
      H.fetches += 1;
      H.order.push('events:start');
      await Promise.resolve();
      H.order.push('events:end');
      return scope?.eventId && scope.eventId !== 'e1' ? [] : [{ id: 'e1', starts_at: '2026-10-10T20:00:00Z' } as never];
    },
    fetchEventHeadcounts: async (_c: unknown, _v: string, scope?: unknown) => {
      H.headScopes.push(scope);
      H.order.push('heads:start');
      return new Map();
    },
  };
});
vi.mock('./adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./adapters')>();
  return { ...actual, toPoEvent: () => ({ id: 'e1', name: 'Event' }) as never };
});

const { usePoEvent } = await import('./hooks');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('usePoEvent notFound (86ey9e9vc review round 2, finding 5)', () => {
  it('is false while the query is disabled (no venueId yet) — not yet "not found", just not run', () => {
    H.venueId = null;
    const { result } = renderHook(() => usePoEvent('missing-id'), { wrapper });
    expect(result.current.isLoading).toBe(false); // disabled query: isPending && isFetching are both false
    expect(result.current.notFound).toBe(false);
  });

  it('is true once the query resolves and the id genuinely is not in the list', async () => {
    H.venueId = 'v1';
    const { result } = renderHook(() => usePoEvent('missing-id'), { wrapper });
    await waitFor(() => expect(result.current.notFound).toBe(true));
  });

  it('is false once the query resolves and the id IS in the list', async () => {
    H.venueId = 'v1';
    const { result } = renderHook(() => usePoEvent('e1'), { wrapper });
    await waitFor(() => expect(result.current.event).not.toBeNull());
    expect(result.current.notFound).toBe(false);
  });

  it('is served from the cached venue list without a request (opened from the Events tab)', async () => {
    H.venueId = 'v1';
    H.fetches = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    // The venue list cache holds the event WINDOW (Snelheid P2): raw rows + headcounts.
    client.setQueryData(poKeys.events('v1'), { rows: [{ id: 'e1' }], heads: {}, sinceIso: '', fetchedAt: 0 });
    const seeded = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePoEvent('e1'), { wrapper: seeded });
    expect(result.current.event).toMatchObject({ id: 'e1' });
    expect(result.current.isLoading).toBe(false);
    expect(H.fetches).toBe(0);
  });

  it('a cache miss counts heads for THIS event only, in parallel with the event row (Snelheid P2)', async () => {
    H.venueId = 'v1';
    H.headScopes = [];
    H.order = [];
    const { result } = renderHook(() => usePoEvent('e1'), { wrapper });
    await waitFor(() => expect(result.current.event).not.toBeNull());
    // Scoped by id — never `{ sinceIso: starts_at }`, which scanned every later event.
    expect(H.headScopes).toEqual([{ eventId: 'e1' }]);
    // Fired before the event row resolved: one round-trip of latency, not two.
    expect(H.order.indexOf('heads:start')).toBeLessThan(H.order.indexOf('events:end'));
  });
});
