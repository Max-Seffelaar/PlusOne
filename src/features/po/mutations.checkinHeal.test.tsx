// @vitest-environment jsdom
//
// Review #491: a FAILED cockpit check-in rolls back to the snapshot from before
// the tap — which can erase a peer's real check-in that a realtime patch put in
// since. The realtime channel no longer refetches per event, so the error path
// itself must refetch guests + arrivals.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/features/door/offline/device', () => ({ getDoorClient: () => ({}), getDeviceId: () => 'dev-1' }));
vi.mock('@/features/door/outbox/gateway', () => ({
  supabaseGateway: () => ({
    insertCheckIn: async () => ({ error: { code: '42501', message: 'denied', details: '' } }),
  }),
}));
vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'v1', userId: 'u1', roles: ['admin'] }),
}));

import { usePoCheckIn } from './mutations';
import { poKeys } from './keys';

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePoCheckIn — error path heals the lists', () => {
  it('rolls back AND refetches guests + arrivals', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(poKeys.guests('e1'), []);
    qc.setQueryData(poKeys.arrivals('e1'), new Map());
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePoCheckIn('e1'), { wrapper });
    act(() => result.current.mutate({ guestId: 'g1', plusOnes: 0 } as never));
    await waitFor(() => expect(result.current.isError).toBe(true));
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(poKeys.guests('e1')));
    expect(keys).toContain(JSON.stringify(poKeys.arrivals('e1')));
  });
});
