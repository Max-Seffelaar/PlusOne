// @vitest-environment jsdom
/**
 * The cockpit's React-Query→`StaleResumeSyncSource` adapter (86eykg2x1). What is
 * verified here is the contract `useStaleResumeGuard` relies on — anything the
 * guard reads wrongly here would silently disarm the guard on this surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { useCockpitSync } from './useCockpitSync';
import type { QueryFreshness } from './cockpitFreshness';

const q = (dataUpdatedAt: number, fetchStatus: QueryFreshness['fetchStatus'] = 'idle'): QueryFreshness => ({
  dataUpdatedAt,
  fetchStatus,
});

describe('useCockpitSync', () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
  });
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('reports the oldest tracked load as lastSyncAt', () => {
    const { result } = renderHook(() =>
      useCockpitSync({ tracked: [q(5_000), q(1_000), q(9_000)], refresh: vi.fn() }),
    );
    expect(result.current.lastSyncAt).toBe(1_000);
  });

  it('reports lastSyncAt null while any tracked query has never loaded', () => {
    // Feeds straight into isSyncStale(null, …) === true, i.e. "never synced".
    const { result } = renderHook(() =>
      useCockpitSync({ tracked: [q(5_000), q(0)], refresh: vi.fn() }),
    );
    expect(result.current.lastSyncAt).toBeNull();
  });

  it('reports syncing while any tracked query is fetching or paused', () => {
    const { result, rerender } = renderHook(
      ({ tracked }) => useCockpitSync({ tracked, refresh: vi.fn() }),
      { initialProps: { tracked: [q(1_000), q(2_000)] as QueryFreshness[] } },
    );
    expect(result.current.syncing).toBe(false);

    rerender({ tracked: [q(1_000, 'fetching'), q(2_000)] });
    expect(result.current.syncing).toBe(true);

    rerender({ tracked: [q(1_000), q(2_000, 'paused')] });
    expect(result.current.syncing).toBe(true);
  });

  it('forceSync calls refresh, and keeps a STABLE identity across renders', () => {
    // The guard registers its visibilitychange listener once and holds whatever
    // `forceSync` existed then; an unstable identity there would be a live bug.
    const first = vi.fn();
    const { result, rerender } = renderHook(
      ({ refresh }) => useCockpitSync({ tracked: [q(1_000)], refresh }),
      { initialProps: { refresh: first } },
    );
    const captured = result.current.forceSync;

    const second = vi.fn();
    rerender({ refresh: second });
    expect(result.current.forceSync).toBe(captured);

    // ...and the captured closure must reach the CURRENT refresh, not the stale one.
    act(() => captured());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('tracks React Query’s online signal', () => {
    onlineManager.setOnline(false);
    const { result, unmount } = renderHook(() => useCockpitSync({ tracked: [q(1_000)], refresh: vi.fn() }));
    expect(result.current.online).toBe(false);

    act(() => onlineManager.setOnline(true));
    expect(result.current.online).toBe(true);

    act(() => onlineManager.setOnline(false));
    expect(result.current.online).toBe(false);
    // Unmount before afterEach flips the manager back, so that reset does not
    // land on a still-mounted hook outside act().
    unmount();
  });

  it('unsubscribes from the online manager on unmount', () => {
    const { unmount } = renderHook(() => useCockpitSync({ tracked: [q(1_000)], refresh: vi.fn() }));
    const before = onlineManager.hasListeners();
    unmount();
    // No listener leak: with nothing else subscribed the manager goes quiet.
    expect(before).toBe(true);
    expect(onlineManager.hasListeners()).toBe(false);
  });
});
