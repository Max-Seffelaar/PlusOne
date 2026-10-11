// @vitest-environment jsdom
/**
 * Review #458 N6: two quick changes to the notification preferences each
 * build on the one before, and an earlier server answer never undoes a later
 * tap.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@/features/notifications/prefs-schema';

const H = vi.hoisted(() => ({
  saves: [] as Array<{ prefs: unknown; resolve: () => void }>,
}));

vi.mock('./PoLiveProvider', () => ({ usePoIdentity: () => ({ userId: 'user-1' }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: vi.fn() }) }));
vi.mock('@/features/notifications/prefs-actions', () => ({
  saveNotificationPrefsAction: (prefs: NotificationPrefs) =>
    new Promise((resolve) => {
      H.saves.push({ prefs, resolve: () => resolve({ ok: true, prefs }) });
    }),
}));

import { usePoSaveNotificationPrefs } from './notification-prefs';
import { poKeys } from './keys';

const KEY = [...poKeys.all, 'notification-prefs', 'user-1'];

describe('usePoSaveNotificationPrefs', () => {
  it('a second quick change keeps the first, and the first answer does not undo it', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(KEY, DEFAULT_NOTIFICATION_PREFS);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePoSaveNotificationPrefs(), { wrapper });

    act(() => {
      result.current.update((p) => ({ ...p, quota: { ...p.quota, push: false } }));
      result.current.update((p) => ({ ...p, digest: false }));
    });
    const both = { ...DEFAULT_NOTIFICATION_PREFS, quota: { push: false, email: 'immediate' }, digest: false };
    expect(qc.getQueryData(KEY)).toEqual(both);

    await waitFor(() => expect(H.saves).toHaveLength(2));
    expect(H.saves[1]?.prefs).toEqual(both);

    // The first save answers while the second is still in flight.
    await act(async () => H.saves[0]?.resolve());
    expect(qc.getQueryData(KEY)).toEqual(both);
    await act(async () => H.saves[1]?.resolve());
    await waitFor(() => expect(qc.isMutating()).toBe(0));
    expect(qc.getQueryData(KEY)).toEqual(both);
  });
});
