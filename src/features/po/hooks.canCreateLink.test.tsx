// @vitest-environment jsdom
/**
 * The ONE gate for every "New link" entry (Requests header, Promotion hub
 * header + empty state), z8uq9m0hw4: admin, or organizer of that event, which
 * is exactly the request_links_insert RLS. Finance reads the Promotion hub and
 * the Requests inbox but can't create a link, so it must never get the button.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const H = vi.hoisted(() => ({ roles: [] as string[], isOrganizer: false }));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u1', venueId: 'v1', venueName: null, roles: H.roles }),
}));
vi.mock('./queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./queries')>();
  return {
    ...actual,
    fetchEventForEdit: async () => ({ id: 'e1', isOrganizer: H.isOrganizer }) as never,
  };
});

const { usePoCanCreateLink } = await import('./hooks');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('usePoCanCreateLink (z8uq9m0hw4)', () => {
  it('lets an admin create, with the venue-wide event picker', () => {
    H.roles = ['admin'];
    H.isOrganizer = false;
    const { result } = renderHook(() => usePoCanCreateLink('e1'), { wrapper });
    expect(result.current).toEqual({ canCreate: true, isAdmin: true });
  });

  it('never lets finance create (reads Promotion, RLS refuses the insert)', async () => {
    H.roles = ['finance'];
    H.isOrganizer = false;
    const { result } = renderHook(() => usePoCanCreateLink('e1'), { wrapper });
    // Settle the event-for-edit read first, so this is the answer, not a loading state.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toEqual({ canCreate: false, isAdmin: false });
  });

  it('lets an organizer of that event create, without the venue-wide picker', async () => {
    H.roles = [];
    H.isOrganizer = true;
    const { result } = renderHook(() => usePoCanCreateLink('e1'), { wrapper });
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    expect(result.current.isAdmin).toBe(false);
  });

  it('has nothing to create on without an event, even for an admin', () => {
    H.roles = ['admin'];
    const { result } = renderHook(() => usePoCanCreateLink(''), { wrapper });
    expect(result.current.canCreate).toBe(false);
  });
});
